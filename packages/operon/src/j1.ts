import { Clock, Effect, Schema } from "effect";

import type { InMemoryAuthority } from "./authority";
import { actionHostBindingSchema, type ActionHostBinding } from "./catalog";
import {
  mailEffectSchema,
  type InMemoryMail,
  type MailEffect,
  type RecipientResolution,
} from "./mail";
import { generatePrefixedId } from "./types";
import { CommonValueTypes } from "./value-types";
import { whatsAppDeliverySchema, whatsAppSendClaim } from "./whatsapp";

const requiredId = Schema.String.check(Schema.isMinLength(1));
const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);
const parseOptions = { onExcessProperty: "error" } as const;

const deliveryDestinationSchema = Schema.Struct({
  artifactRevision: requiredId,
  attachments: Schema.Array(requiredId),
  recipientHandles: Schema.Array(requiredId).check(Schema.isMinLength(1)),
  replyAll: Schema.Boolean,
  threadId: requiredId,
});
export type DeliveryDestination = typeof deliveryDestinationSchema.Type;

const fulfillmentEvidenceSchema = Schema.Union([
  mailEffectSchema,
  Schema.Struct({
    delivery: whatsAppDeliverySchema,
    kind: Schema.Literal("whatsapp_send"),
    messageId: requiredId,
  }),
]);
export type FulfillmentEvidence = typeof fulfillmentEvidenceSchema.Type;

export type DeliveryFulfillment = "completed" | "incomplete";

export interface DeliveryDraft {
  readonly commitmentId: string;
  readonly deadline?: string;
  readonly destination: DeliveryDestination;
  readonly effect: MailEffect;
  readonly id: string;
  readonly status: "completed" | "invalidated" | "prepared";
  readonly userId: string;
  readonly workspaceId: string;
}

export class J1WorkflowRejected extends Schema.TaggedError<J1WorkflowRejected>()(
  "J1WorkflowRejected",
  {
    reason: Schema.Literals([
      "already_completed",
      "commitment_not_open",
      "draft_invalidated",
      "draft_missing",
      "fulfillment_not_sent",
      "invalid_parameter",
      "invalid_scope",
      "recipient_unresolved",
    ]),
  }
) {}

interface WorkflowState {
  readonly completed: Map<string, string>;
  readonly deadlines: Map<string, string>;
  readonly drafts: Map<string, DeliveryDraft>;
}

function reject(reason: J1WorkflowRejected["reason"]) {
  return new J1WorkflowRejected({ reason });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

function commitmentKey(scope: ActionHostBinding, commitmentId: string): string {
  return recordKey(scope, commitmentId);
}

function isResolvedRecipient(row: RecipientResolution): boolean {
  switch (row.kind) {
    case "contact":
    case "participant":
      return true;
    case "ambiguous":
    case "unknown":
      return false;
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

export function deliveryFulfillment(
  evidence: FulfillmentEvidence
): DeliveryFulfillment {
  switch (evidence.kind) {
    case "chat_send":
    case "local_draft":
    case "mailbox_draft":
      return "incomplete";
    case "provider_sent":
      return "completed";
    case "whatsapp_send":
      return whatsAppSendClaim(evidence.delivery) === "delivered"
        ? "completed"
        : "incomplete";
    default: {
      const exhaustive: never = evidence;
      return exhaustive;
    }
  }
}

function receiptThreadId(evidence: FulfillmentEvidence): string | undefined {
  switch (evidence.kind) {
    case "provider_sent":
      return evidence.threadId;
    case "chat_send":
    case "local_draft":
    case "mailbox_draft":
    case "whatsapp_send":
      return undefined;
    default: {
      const exhaustive: never = evidence;
      return exhaustive;
    }
  }
}

const requireHost = Effect.fn("InMemoryJ1Workflow.requireHost")(function* (
  scope: ActionHostBinding
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
});

const requireDraft = Effect.fn("InMemoryJ1Workflow.requireDraft")(function* (
  state: WorkflowState,
  scope: ActionHostBinding,
  draftId: string
) {
  const host = yield* requireHost(scope);
  const draft = state.drafts.get(recordKey(host, draftId));
  if (
    !draft ||
    draft.userId !== host.userId ||
    draft.workspaceId !== host.workspaceId
  ) {
    return yield* reject("draft_missing");
  }
  return draft;
});

const requireOpenCommitment = Effect.fn(
  "InMemoryJ1Workflow.requireOpenCommitment"
)(function* (
  authority: InMemoryAuthority,
  state: WorkflowState,
  scope: ActionHostBinding,
  commitmentId: string
) {
  const host = yield* requireHost(scope);
  if (state.completed.has(commitmentKey(host, commitmentId))) {
    return yield* reject("already_completed");
  }
  const snapshot = yield* authority.getObject(host, commitmentId).pipe(
    Effect.catchTags({
      AuthorityInputRejected: () => Effect.fail(reject("invalid_scope")),
    })
  );
  if (
    snapshot?.eligibility !== "eligible" ||
    (snapshot.operationalStatus !== "accepted" &&
      snapshot.operationalStatus !== "delivery_prepared")
  ) {
    return yield* reject("commitment_not_open");
  }
  return host;
});

function invalidatePrepared(
  state: WorkflowState,
  host: ActionHostBinding,
  commitmentId: string
): void {
  for (const [key, draft] of state.drafts) {
    if (
      draft.userId === host.userId &&
      draft.workspaceId === host.workspaceId &&
      draft.commitmentId === commitmentId &&
      draft.status === "prepared"
    ) {
      state.drafts.set(key, { ...draft, status: "invalidated" });
    }
  }
}

const prepareDraftImpl = Effect.fn("InMemoryJ1Workflow.prepareDraft")(
  function* (
    authority: InMemoryAuthority,
    mail: InMemoryMail,
    state: WorkflowState,
    scope: ActionHostBinding,
    commitmentId: string,
    encodedDestination: Schema.Json
  ) {
    const host = yield* requireOpenCommitment(
      authority,
      state,
      scope,
      commitmentId
    );
    const destination = yield* Schema.decodeUnknownEffect(
      deliveryDestinationSchema,
      parseOptions
    )(encodedDestination).pipe(
      Effect.mapError(() => reject("invalid_parameter"))
    );
    for (const handle of destination.recipientHandles) {
      const resolved = yield* mail.resolveRecipient(host, handle).pipe(
        Effect.catchTags({
          MailRejected: () => Effect.fail(reject("invalid_parameter")),
        })
      );
      if (!isResolvedRecipient(resolved)) {
        return yield* reject("recipient_unresolved");
      }
    }
    invalidatePrepared(state, host, commitmentId);
    const recordedAt = yield* Clock.currentTimeMillis;
    const draftId = generatePrefixedId("drf", recordedAt);
    const effect: MailEffect = {
      draftId,
      kind: "local_draft",
    };
    const deadline = state.deadlines.get(commitmentKey(host, commitmentId));
    const draft: DeliveryDraft =
      deadline === undefined
        ? {
            commitmentId,
            destination,
            effect,
            id: draftId,
            status: "prepared",
            userId: host.userId,
            workspaceId: host.workspaceId,
          }
        : {
            commitmentId,
            deadline,
            destination,
            effect,
            id: draftId,
            status: "prepared",
            userId: host.userId,
            workspaceId: host.workspaceId,
          };
    state.drafts.set(recordKey(host, draft.id), draft);
    return draft;
  }
);

const interruptImpl = Effect.fn("InMemoryJ1Workflow.interrupt")(function* (
  state: WorkflowState,
  scope: ActionHostBinding,
  draftId: string
) {
  const draft = yield* requireDraft(state, scope, draftId);
  switch (draft.status) {
    case "completed":
      return yield* reject("already_completed");
    case "invalidated":
      return draft;
    case "prepared": {
      const invalidated: DeliveryDraft = { ...draft, status: "invalidated" };
      state.drafts.set(
        recordKey(
          { userId: draft.userId, workspaceId: draft.workspaceId },
          draft.id
        ),
        invalidated
      );
      return invalidated;
    }
    default: {
      const exhaustive: never = draft.status;
      return exhaustive;
    }
  }
});

const changeDeadlineImpl = Effect.fn("InMemoryJ1Workflow.changeDeadline")(
  function* (
    authority: InMemoryAuthority,
    state: WorkflowState,
    scope: ActionHostBinding,
    commitmentId: string,
    deadline: string
  ) {
    const host = yield* requireOpenCommitment(
      authority,
      state,
      scope,
      commitmentId
    );
    const decoded = yield* Schema.decodeUnknownEffect(
      CommonValueTypes.ISO8601String.schema
    )(deadline).pipe(Effect.mapError(() => reject("invalid_parameter")));
    state.deadlines.set(commitmentKey(host, commitmentId), decoded);
    invalidatePrepared(state, host, commitmentId);
    return decoded;
  }
);

const observeDestinationImpl = Effect.fn(
  "InMemoryJ1Workflow.observeDestination"
)(function* (state: WorkflowState, scope: ActionHostBinding, draftId: string) {
  const draft = yield* requireDraft(state, scope, draftId);
  return draft.destination;
});

const recordEffectImpl = Effect.fn("InMemoryJ1Workflow.recordEffect")(
  function* (
    state: WorkflowState,
    scope: ActionHostBinding,
    draftId: string,
    encodedEvidence: Schema.Json
  ) {
    const host = yield* requireHost(scope);
    const draft = yield* requireDraft(state, scope, draftId);
    switch (draft.status) {
      case "completed":
        return yield* reject("already_completed");
      case "invalidated":
        return yield* reject("draft_invalidated");
      case "prepared":
        break;
      default: {
        const exhaustive: never = draft.status;
        return exhaustive;
      }
    }
    if (state.completed.has(commitmentKey(host, draft.commitmentId))) {
      return yield* reject("already_completed");
    }
    const evidence = yield* Schema.decodeUnknownEffect(
      fulfillmentEvidenceSchema,
      parseOptions
    )(encodedEvidence).pipe(Effect.mapError(() => reject("invalid_parameter")));
    if (deliveryFulfillment(evidence) !== "completed") {
      return yield* reject("fulfillment_not_sent");
    }
    const threadId = receiptThreadId(evidence);
    if (threadId !== undefined && threadId !== draft.destination.threadId) {
      return yield* reject("invalid_parameter");
    }
    const completed: DeliveryDraft = { ...draft, status: "completed" };
    state.drafts.set(recordKey(host, draft.id), completed);
    state.completed.set(commitmentKey(host, draft.commitmentId), draft.id);
    return completed;
  }
);

/**
 * Host-scoped J1 delivery composition over Action lifecycle and mail/WhatsApp
 * send-claim catalogs. Drafts are local effects; this module does not fetch or
 * send Gmail/WhatsApp and does not write Mem0.
 */
export class InMemoryJ1Workflow {
  readonly #state: WorkflowState = {
    completed: new Map(),
    deadlines: new Map(),
    drafts: new Map(),
  };

  constructor(
    readonly authority: InMemoryAuthority,
    readonly mail: InMemoryMail
  ) {}

  prepareDraft(
    scope: ActionHostBinding,
    commitmentId: string,
    encodedDestination: Schema.Json
  ) {
    return prepareDraftImpl(
      this.authority,
      this.mail,
      this.#state,
      scope,
      commitmentId,
      encodedDestination
    );
  }

  interrupt(scope: ActionHostBinding, draftId: string) {
    return interruptImpl(this.#state, scope, draftId);
  }

  changeDeadline(
    scope: ActionHostBinding,
    commitmentId: string,
    deadline: string
  ) {
    return changeDeadlineImpl(
      this.authority,
      this.#state,
      scope,
      commitmentId,
      deadline
    );
  }

  observeDestination(scope: ActionHostBinding, draftId: string) {
    return observeDestinationImpl(this.#state, scope, draftId);
  }

  recordEffect(
    scope: ActionHostBinding,
    draftId: string,
    encodedEvidence: Schema.Json
  ) {
    return recordEffectImpl(this.#state, scope, draftId, encodedEvidence);
  }
}
