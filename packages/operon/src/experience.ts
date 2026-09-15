import { Clock, Effect, Schema } from "effect";

import {
  isOperationalPredicate,
  type InMemoryAuthority,
  type ObjectSnapshot,
  type PersistedClaim,
} from "./authority";
import {
  actionHostBindingSchema,
  isCoSelectionLinkId,
  type ActionHostBinding,
} from "./catalog";
import { generatePrefixedId } from "./types";

const requiredId = Schema.String.check(Schema.isMinLength(1));
const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);
const parseOptions = { onExcessProperty: "error" } as const;

const briefingAudienceSchema = Schema.Struct({
  channel: Schema.optionalKey(Schema.Literals(["telegram", "web", "whatsapp"])),
  userId: requiredId,
});
export type BriefingAudience = typeof briefingAudienceSchema.Type;

const briefingModeSchema = Schema.Literals(["on_demand", "scheduled"]);
export type BriefingMode = typeof briefingModeSchema.Type;

export type KnowledgeKind =
  | "accepted_fact"
  | "candidate"
  | "retrieval_association"
  | "source_narrative"
  | "uncertainty";

export type KnowledgeRow =
  | {
      readonly kind: "accepted_fact";
      readonly objectId: string;
      readonly predicate: string;
      readonly typeId: string;
      readonly value: Schema.Json;
    }
  | {
      readonly kind: "candidate";
      readonly objectId: string;
      readonly predicate: string;
      readonly typeId: string;
    }
  | {
      readonly kind: "retrieval_association";
      readonly objectId: string;
      readonly relatedObjectId: string;
      readonly typeId: string;
    }
  | {
      readonly kind: "source_narrative";
      readonly objectId: string;
      readonly sourceId: string;
      readonly typeId: string;
    }
  | {
      readonly kind: "uncertainty";
      readonly objectId: string;
      readonly typeId: string;
    };

export type ReplyLengthPolicy = "concise" | "full";

export class ExperienceRejected extends Schema.TaggedError<ExperienceRejected>()(
  "ExperienceRejected",
  {
    reason: Schema.Literals([
      "audience_required",
      "comment_missing",
      "conversation_missing",
      "document_missing",
      "invalid_parameter",
      "invalid_scope",
      "stale_revision",
    ]),
  }
) {}

interface StoredConversation {
  readonly groupId: string;
  readonly id: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface StoredComment {
  readonly id: string;
  readonly open: boolean;
}

interface StoredDocument {
  readonly body: string;
  readonly comments: Map<string, StoredComment>;
  readonly id: string;
  readonly jobDone: boolean;
  readonly revision: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface ExperienceState {
  readonly conversations: Map<string, StoredConversation>;
  readonly documents: Map<string, StoredDocument>;
  readonly retrievals: Map<string, readonly [string, string]>;
  readonly taskObjects: Map<string, Set<string>>;
}

function reject(reason: ExperienceRejected["reason"]) {
  return new ExperienceRejected({ reason });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

function selectable(snapshot: ObjectSnapshot): boolean {
  switch (snapshot.eligibility) {
    case "eligible":
    case "pruned":
      return true;
    case "forgotten":
    case "unauthorized":
    case "withdrawn":
      return false;
    default: {
      const exhaustive: never = snapshot.eligibility;
      return exhaustive;
    }
  }
}

export function replyLengthPolicy(
  task: "analysis" | "short"
): ReplyLengthPolicy {
  switch (task) {
    case "analysis":
      return "full";
    case "short":
      return "concise";
    default: {
      const exhaustive: never = task;
      return exhaustive;
    }
  }
}

function classifyClaim(
  snapshot: ObjectSnapshot,
  claim: PersistedClaim
): KnowledgeRow | undefined {
  if (claim.kind === "provider_metadata") {
    const row: KnowledgeRow = {
      kind: "source_narrative",
      objectId: snapshot.id,
      sourceId: claim.sourceId,
      typeId: snapshot.typeId,
    };
    return row;
  }
  switch (claim.state) {
    case "accepted":
      if (isOperationalPredicate(claim.predicate)) {
        return undefined;
      }
      return {
        kind: "accepted_fact",
        objectId: snapshot.id,
        predicate: claim.predicate,
        typeId: snapshot.typeId,
        value: claim.value,
      };
    case "proposed":
      return {
        kind: "candidate",
        objectId: snapshot.id,
        predicate: claim.predicate,
        typeId: snapshot.typeId,
      };
    case "separated":
    case "superseded":
      return undefined;
    default: {
      const exhaustive: never = claim.state;
      return exhaustive;
    }
  }
}

const requireHost = Effect.fn("InMemoryHostExperience.requireHost")(function* (
  scope: ActionHostBinding
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
});

const projectKnowledgeImpl = Effect.fn(
  "InMemoryHostExperience.projectKnowledge"
)(function* (
  authority: InMemoryAuthority,
  state: ExperienceState,
  scope: ActionHostBinding
) {
  const host = yield* requireHost(scope);
  const snapshots = yield* authority.listObjects(host).pipe(
    Effect.catchTags({
      AuthorityInputRejected: () => Effect.fail(reject("invalid_scope")),
    })
  );
  const rows: KnowledgeRow[] = [];
  for (const snapshot of snapshots) {
    if (!selectable(snapshot)) {
      continue;
    }
    const evidence = yield* authority.queryEvidence(host, snapshot.id).pipe(
      Effect.catchTags({
        AuthorityInputRejected: () => Effect.fail(reject("invalid_scope")),
      })
    );
    let accepted = 0;
    let candidates = 0;
    for (const claim of evidence.claims) {
      const row = classifyClaim(snapshot, claim);
      if (!row) {
        continue;
      }
      rows.push(row);
      if (row.kind === "accepted_fact") {
        accepted += 1;
      }
      if (row.kind === "candidate") {
        candidates += 1;
      }
    }
    if (accepted === 0 || candidates > 0) {
      rows.push({
        kind: "uncertainty",
        objectId: snapshot.id,
        typeId: snapshot.typeId,
      });
    }
  }
  for (const [left, right] of state.retrievals.values()) {
    const leftSnap = snapshots.find((row) => row.id === left);
    if (leftSnap && selectable(leftSnap)) {
      rows.push({
        kind: "retrieval_association",
        objectId: left,
        relatedObjectId: right,
        typeId: leftSnap.typeId,
      });
    }
  }
  return rows;
});

const projectTaskImpl = Effect.fn("InMemoryHostExperience.projectTask")(
  function* (
    authority: InMemoryAuthority,
    state: ExperienceState,
    scope: ActionHostBinding,
    taskId: string
  ) {
    const host = yield* requireHost(scope);
    const id = taskId.trim();
    if (id.length === 0) {
      return yield* reject("invalid_parameter");
    }
    const bound = state.taskObjects.get(recordKey(host, id)) ?? new Set();
    const rows = yield* projectKnowledgeImpl(authority, state, host);
    return rows.filter(
      (row) => bound.has(row.objectId) || row.typeId === "preference"
    );
  }
);

const projectWorkImpl = Effect.fn("InMemoryHostExperience.projectWork")(
  function* (authority: InMemoryAuthority, scope: ActionHostBinding) {
    const host = yield* requireHost(scope);
    const snapshots = yield* authority.listObjects(host).pipe(
      Effect.catchTags({
        AuthorityInputRejected: () => Effect.fail(reject("invalid_scope")),
      })
    );
    const currentWork: string[] = [];
    const needsDecision: string[] = [];
    for (const snapshot of snapshots) {
      if (!selectable(snapshot) || snapshot.typeId !== "commitment") {
        continue;
      }
      switch (snapshot.operationalStatus) {
        case "accepted":
        case "delivery_prepared":
          currentWork.push(snapshot.id);
          break;
        case "proposed":
          needsDecision.push(snapshot.id);
          break;
        default:
          break;
      }
    }
    return { currentWork, needsDecision };
  }
);

const explainWhyImpl = Effect.fn("InMemoryHostExperience.explainWhy")(
  function* (
    authority: InMemoryAuthority,
    scope: ActionHostBinding,
    objectId: string
  ) {
    const host = yield* requireHost(scope);
    const snapshot = yield* authority.getObject(host, objectId).pipe(
      Effect.catchTags({
        AuthorityInputRejected: () => Effect.fail(reject("invalid_scope")),
      })
    );
    if (!snapshot || !selectable(snapshot)) {
      return yield* reject("invalid_parameter");
    }
    const evidence = yield* authority.queryEvidence(host, objectId).pipe(
      Effect.catchTags({
        AuthorityInputRejected: () => Effect.fail(reject("invalid_scope")),
      })
    );
    const facts = evidence.claims.filter(
      (claim) =>
        claim.state === "accepted" && !isOperationalPredicate(claim.predicate)
    );
    const candidates = evidence.claims.filter(
      (claim) => claim.state === "proposed"
    );
    return {
      candidates: candidates.map((claim) => claim.predicate),
      facts: facts.map((claim) => claim.predicate),
      objectId,
      uncertainty: facts.length === 0 || candidates.length > 0,
    };
  }
);

const bindTaskObjectImpl = Effect.fn("InMemoryHostExperience.bindTaskObject")(
  function* (
    authority: InMemoryAuthority,
    state: ExperienceState,
    scope: ActionHostBinding,
    taskId: string,
    objectId: string
  ) {
    const host = yield* requireHost(scope);
    const task = taskId.trim();
    const object = objectId.trim();
    if (task.length === 0 || object.length === 0) {
      return yield* reject("invalid_parameter");
    }
    const snapshot = yield* authority.getObject(host, object).pipe(
      Effect.catchTags({
        AuthorityInputRejected: () => Effect.fail(reject("invalid_scope")),
      })
    );
    if (!snapshot || !selectable(snapshot)) {
      return yield* reject("invalid_parameter");
    }
    const key = recordKey(host, task);
    const bound = state.taskObjects.get(key) ?? new Set();
    bound.add(object);
    state.taskObjects.set(key, bound);
    return object;
  }
);

const associateRetrievalImpl = Effect.fn(
  "InMemoryHostExperience.associateRetrieval"
)(function* (
  state: ExperienceState,
  scope: ActionHostBinding,
  linkId: string,
  leftObjectId: string,
  rightObjectId: string
) {
  const host = yield* requireHost(scope);
  if (
    !isCoSelectionLinkId(linkId) ||
    leftObjectId.trim() === "" ||
    rightObjectId.trim() === ""
  ) {
    return yield* reject("invalid_parameter");
  }
  state.retrievals.set(recordKey(host, `${leftObjectId}\0${rightObjectId}`), [
    leftObjectId,
    rightObjectId,
  ]);
  return leftObjectId;
});

const openConversationImpl = Effect.fn(
  "InMemoryHostExperience.openConversation"
)(function* (
  state: ExperienceState,
  scope: ActionHostBinding,
  conversationId: string,
  groupId: string
) {
  const host = yield* requireHost(scope);
  const id = conversationId.trim();
  const group = groupId.trim();
  if (id.length === 0 || group.length === 0) {
    return yield* reject("invalid_parameter");
  }
  const conversation: StoredConversation = {
    groupId: group,
    id,
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
  state.conversations.set(recordKey(host, id), conversation);
  return conversation;
});

const moveConversationImpl = Effect.fn(
  "InMemoryHostExperience.moveConversation"
)(function* (
  state: ExperienceState,
  scope: ActionHostBinding,
  conversationId: string,
  groupId: string
) {
  const host = yield* requireHost(scope);
  const group = groupId.trim();
  if (group.length === 0) {
    return yield* reject("invalid_parameter");
  }
  const key = recordKey(host, conversationId);
  const current = state.conversations.get(key);
  if (
    !current ||
    current.userId !== host.userId ||
    current.workspaceId !== host.workspaceId
  ) {
    return yield* reject("conversation_missing");
  }
  const moved: StoredConversation = { ...current, groupId: group };
  state.conversations.set(key, moved);
  return {
    agreements: [] as const,
    grants: [] as const,
    groupId: moved.groupId,
    shares: [] as const,
  };
});

const inspectConversationImpl = Effect.fn(
  "InMemoryHostExperience.inspectConversation"
)(function* (
  state: ExperienceState,
  scope: ActionHostBinding,
  conversationId: string
) {
  const host = yield* requireHost(scope);
  const current = state.conversations.get(recordKey(host, conversationId));
  if (
    !current ||
    current.userId !== host.userId ||
    current.workspaceId !== host.workspaceId
  ) {
    return yield* reject("conversation_missing");
  }
  return {
    agreements: [] as const,
    grants: [] as const,
    groupId: current.groupId,
    shares: [] as const,
  };
});

const putDocumentImpl = Effect.fn("InMemoryHostExperience.putDocument")(
  function* (
    state: ExperienceState,
    scope: ActionHostBinding,
    documentId: string,
    body: string
  ) {
    const host = yield* requireHost(scope);
    const id = documentId.trim();
    if (id.length === 0) {
      return yield* reject("invalid_parameter");
    }
    const document: StoredDocument = {
      body,
      comments: new Map(),
      id,
      jobDone: false,
      revision: "1",
      userId: host.userId,
      workspaceId: host.workspaceId,
    };
    state.documents.set(recordKey(host, id), document);
    return { id, jobDone: false, revision: document.revision };
  }
);

function requireDocument(
  state: ExperienceState,
  host: ActionHostBinding,
  documentId: string
) {
  const document = state.documents.get(recordKey(host, documentId));
  if (
    !document ||
    document.userId !== host.userId ||
    document.workspaceId !== host.workspaceId
  ) {
    return reject("document_missing");
  }
  return document;
}

const previewReplaceImpl = Effect.fn("InMemoryHostExperience.previewReplace")(
  function* (
    state: ExperienceState,
    scope: ActionHostBinding,
    documentId: string,
    expectedRevision: string,
    nextBody: string
  ) {
    const host = yield* requireHost(scope);
    const document = requireDocument(state, host, documentId);
    if (document instanceof ExperienceRejected) {
      return yield* document;
    }
    if (document.revision !== expectedRevision) {
      return yield* reject("stale_revision");
    }
    return { body: nextBody, revision: document.revision };
  }
);

const applyReplaceImpl = Effect.fn("InMemoryHostExperience.applyReplace")(
  function* (
    state: ExperienceState,
    scope: ActionHostBinding,
    documentId: string,
    expectedRevision: string,
    nextBody: string
  ) {
    const host = yield* requireHost(scope);
    const document = requireDocument(state, host, documentId);
    if (document instanceof ExperienceRejected) {
      return yield* document;
    }
    if (document.revision !== expectedRevision) {
      return yield* reject("stale_revision");
    }
    const recordedAt = yield* Clock.currentTimeMillis;
    const next: StoredDocument = {
      ...document,
      body: nextBody,
      revision: String(Number(document.revision) + 1),
    };
    state.documents.set(recordKey(host, document.id), next);
    return {
      id: next.id,
      jobDone: next.jobDone,
      recordedAt,
      revision: next.revision,
    };
  }
);

const openCommentImpl = Effect.fn("InMemoryHostExperience.openComment")(
  function* (
    state: ExperienceState,
    scope: ActionHostBinding,
    documentId: string
  ) {
    const host = yield* requireHost(scope);
    const document = requireDocument(state, host, documentId);
    if (document instanceof ExperienceRejected) {
      return yield* document;
    }
    const recordedAt = yield* Clock.currentTimeMillis;
    const comment: StoredComment = {
      id: generatePrefixedId("cmm", recordedAt),
      open: true,
    };
    document.comments.set(comment.id, comment);
    return comment.id;
  }
);

const resolveCommentImpl = Effect.fn("InMemoryHostExperience.resolveComment")(
  function* (
    state: ExperienceState,
    scope: ActionHostBinding,
    documentId: string,
    commentId: string
  ) {
    const host = yield* requireHost(scope);
    const document = requireDocument(state, host, documentId);
    if (document instanceof ExperienceRejected) {
      return yield* document;
    }
    const comment = document.comments.get(commentId);
    if (!comment) {
      return yield* reject("comment_missing");
    }
    document.comments.set(commentId, { ...comment, open: false });
    return { commentId, jobDone: document.jobDone, open: false };
  }
);

const composeBriefingImpl = Effect.fn("InMemoryHostExperience.composeBriefing")(
  function* (
    authority: InMemoryAuthority,
    state: ExperienceState,
    scope: ActionHostBinding,
    mode: BriefingMode,
    encodedAudience: Schema.Json
  ) {
    const host = yield* requireHost(scope);
    const decodedMode = yield* Schema.decodeUnknownEffect(briefingModeSchema)(
      mode
    ).pipe(Effect.mapError(() => reject("invalid_parameter")));
    const audience = yield* Schema.decodeUnknownEffect(
      briefingAudienceSchema,
      parseOptions
    )(encodedAudience).pipe(Effect.mapError(() => reject("audience_required")));
    if (audience.userId !== host.userId) {
      return yield* reject("audience_required");
    }
    const rows = yield* projectKnowledgeImpl(authority, state, host);
    return {
      audience,
      lengthPolicy: "match_task" as const,
      mode: decodedMode,
      rows,
    };
  }
);

/**
 * Host-scoped Today/knowledge/decision projections over existing Operon
 * records. Conversation groups are navigation only. Document comment resolve
 * is not domain success. This catalog does not mount Operon or write Mem0.
 */
export class InMemoryHostExperience {
  readonly #state: ExperienceState = {
    conversations: new Map(),
    documents: new Map(),
    retrievals: new Map(),
    taskObjects: new Map(),
  };

  constructor(readonly authority: InMemoryAuthority) {}

  projectKnowledge(scope: ActionHostBinding) {
    return projectKnowledgeImpl(this.authority, this.#state, scope);
  }

  projectTask(scope: ActionHostBinding, taskId: string) {
    return projectTaskImpl(this.authority, this.#state, scope, taskId);
  }

  projectWork(scope: ActionHostBinding) {
    return projectWorkImpl(this.authority, scope);
  }

  explainWhy(scope: ActionHostBinding, objectId: string) {
    return explainWhyImpl(this.authority, scope, objectId);
  }

  bindTaskObject(scope: ActionHostBinding, taskId: string, objectId: string) {
    return bindTaskObjectImpl(
      this.authority,
      this.#state,
      scope,
      taskId,
      objectId
    );
  }

  associateRetrieval(
    scope: ActionHostBinding,
    linkId: string,
    leftObjectId: string,
    rightObjectId: string
  ) {
    return associateRetrievalImpl(
      this.#state,
      scope,
      linkId,
      leftObjectId,
      rightObjectId
    );
  }

  openConversation(
    scope: ActionHostBinding,
    conversationId: string,
    groupId: string
  ) {
    return openConversationImpl(this.#state, scope, conversationId, groupId);
  }

  moveConversation(
    scope: ActionHostBinding,
    conversationId: string,
    groupId: string
  ) {
    return moveConversationImpl(this.#state, scope, conversationId, groupId);
  }

  inspectConversation(scope: ActionHostBinding, conversationId: string) {
    return inspectConversationImpl(this.#state, scope, conversationId);
  }

  putDocument(scope: ActionHostBinding, documentId: string, body: string) {
    return putDocumentImpl(this.#state, scope, documentId, body);
  }

  previewReplace(
    scope: ActionHostBinding,
    documentId: string,
    expectedRevision: string,
    nextBody: string
  ) {
    return previewReplaceImpl(
      this.#state,
      scope,
      documentId,
      expectedRevision,
      nextBody
    );
  }

  applyReplace(
    scope: ActionHostBinding,
    documentId: string,
    expectedRevision: string,
    nextBody: string
  ) {
    return applyReplaceImpl(
      this.#state,
      scope,
      documentId,
      expectedRevision,
      nextBody
    );
  }

  openComment(scope: ActionHostBinding, documentId: string) {
    return openCommentImpl(this.#state, scope, documentId);
  }

  resolveComment(
    scope: ActionHostBinding,
    documentId: string,
    commentId: string
  ) {
    return resolveCommentImpl(this.#state, scope, documentId, commentId);
  }

  composeBriefing(
    scope: ActionHostBinding,
    mode: BriefingMode,
    encodedAudience: Schema.Json
  ) {
    return composeBriefingImpl(
      this.authority,
      this.#state,
      scope,
      mode,
      encodedAudience
    );
  }
}
