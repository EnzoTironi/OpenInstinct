import { Clock, Effect, Schema } from "effect";

import { actionHostBindingSchema, type ActionHostBinding } from "./catalog";
import { generatePrefixedId } from "./types";

export const OPERATIONAL_PREDICATES = [
  "accepted",
  "completed",
  "discharged",
  "obligationDischarged",
  "status",
] as const;

const operationalPredicateSet = new Set<string>(OPERATIONAL_PREDICATES);

export function isOperationalPredicate(predicate: string): boolean {
  return operationalPredicateSet.has(predicate);
}

const requiredId = Schema.String.check(Schema.isMinLength(1));

export const sourceOccurrenceSchema = Schema.Struct({
  id: requiredId,
  metadata: Schema.Record(Schema.String, Schema.String),
  observedAt: Schema.Number,
  providerId: requiredId,
  providerRevision: requiredId,
  recordedAt: Schema.Number,
  userId: requiredId,
  workspaceId: requiredId,
});
export type SourceOccurrence = typeof sourceOccurrenceSchema.Type;

export const claimKindSchema = Schema.Literals([
  "interpretation",
  "provider_metadata",
]);
export type ClaimKind = typeof claimKindSchema.Type;

export const persistedClaimStateSchema = Schema.Literals([
  "accepted",
  "proposed",
  "separated",
  "superseded",
]);
export type PersistedClaimState = typeof persistedClaimStateSchema.Type;

export const persistedClaimSchema = Schema.Struct({
  id: requiredId,
  kind: claimKindSchema,
  predicate: requiredId,
  recordedAt: Schema.Number,
  sourceId: requiredId,
  state: persistedClaimStateSchema,
  subjectId: requiredId,
  userId: requiredId,
  value: Schema.Json,
  workspaceId: requiredId,
});
export type PersistedClaim = typeof persistedClaimSchema.Type;

export const objectSnapshotSchema = Schema.Struct({
  body: Schema.Record(Schema.String, Schema.Json),
  id: requiredId,
  operationalStatus: Schema.optionalKey(Schema.String),
  recordedAt: Schema.Number,
  revision: requiredId,
  typeId: requiredId,
  userId: requiredId,
  workspaceId: requiredId,
});
export type ObjectSnapshot = typeof objectSnapshotSchema.Type;

export const contactIdentitySchema = Schema.Struct({
  handle: requiredId,
  id: requiredId,
  personId: requiredId,
  userId: requiredId,
  workspaceId: requiredId,
});
export type ContactIdentity = typeof contactIdentitySchema.Type;

export const identityMergeStatusSchema = Schema.Literals([
  "accepted",
  "proposed",
  "separated",
]);
export type IdentityMergeStatus = typeof identityMergeStatusSchema.Type;

export const identityMergeSchema = Schema.Struct({
  evidenceSourceId: requiredId,
  id: requiredId,
  leftIdentityId: requiredId,
  leftPersonId: requiredId,
  rightIdentityId: requiredId,
  rightPersonId: requiredId,
  status: identityMergeStatusSchema,
  userId: requiredId,
  workspaceId: requiredId,
});
export type IdentityMerge = typeof identityMergeSchema.Type;

export const evidenceQuerySchema = Schema.Struct({
  claims: Schema.Array(persistedClaimSchema),
  sources: Schema.Array(sourceOccurrenceSchema),
});
export type EvidenceQuery = typeof evidenceQuerySchema.Type;

export class AuthorityInputRejected extends Schema.TaggedError<AuthorityInputRejected>()(
  "AuthorityInputRejected",
  {
    reason: Schema.Literals([
      "invalid_parameter",
      "invalid_scope",
      "missing_evidence",
      "unsupported_match",
    ]),
  }
) {}

export class AuthorityConflict extends Schema.TaggedError<AuthorityConflict>()(
  "AuthorityConflict",
  {
    actualRevision: Schema.String,
    expectedRevision: Schema.String,
    objectId: Schema.String,
  }
) {}

interface AuthorityState {
  readonly claims: Map<string, PersistedClaim>;
  readonly identities: Map<string, ContactIdentity>;
  readonly merges: Map<string, IdentityMerge>;
  readonly objects: Map<string, ObjectSnapshot>;
  readonly providerKeys: Map<string, string>;
  readonly revisions: Map<string, ObjectSnapshot>;
  readonly sources: Map<string, SourceOccurrence>;
}

const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);

function reject(reason: AuthorityInputRejected["reason"]) {
  return new AuthorityInputRejected({ reason });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

function clone<A>(value: A): A {
  return structuredClone(value);
}

function sourceMentionsHandle(
  source: SourceOccurrence,
  handle: string
): boolean {
  return Object.values(source.metadata).some((value) => value.includes(handle));
}

function ensureObject(
  state: AuthorityState,
  host: ActionHostBinding,
  objectId: string,
  typeId: string,
  recordedAt: number
): ObjectSnapshot {
  const key = recordKey(host, objectId);
  const existing = state.objects.get(key);
  if (existing) return existing;
  const snapshot: ObjectSnapshot = {
    body: {},
    id: objectId,
    operationalStatus: typeId === "commitment" ? "proposed" : undefined,
    recordedAt,
    revision: "1",
    typeId,
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
  state.objects.set(key, snapshot);
  state.revisions.set(`${key}\0${snapshot.revision}`, clone(snapshot));
  return snapshot;
}

function projectAcceptedClaim(
  state: AuthorityState,
  host: ActionHostBinding,
  claim: PersistedClaim,
  recordedAt: number
): void {
  const current = ensureObject(
    state,
    host,
    claim.subjectId,
    "commitment",
    recordedAt
  );
  const next: ObjectSnapshot = {
    ...current,
    body: { ...current.body, [claim.predicate]: claim.value },
    recordedAt,
    revision: String(Number(current.revision) + 1),
  };
  const key = recordKey(host, current.id);
  state.objects.set(key, next);
  state.revisions.set(`${key}\0${next.revision}`, clone(next));
}

const admitSourceImpl = Effect.fn("InMemoryAuthority.admitSource")(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  providerId: string,
  providerRevision: string,
  metadata: Readonly<Record<string, string>>,
  observedAt: number
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const providerKey = `${scopeKey(host)}\0${providerId}\0${providerRevision}`;
  const existingId = state.providerKeys.get(providerKey);
  if (existingId) {
    const existing = state.sources.get(recordKey(host, existingId));
    if (!existing) {
      return yield* reject("invalid_parameter");
    }
    return clone(existing);
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  const source: SourceOccurrence = {
    id: generatePrefixedId("src", recordedAt),
    metadata: { ...metadata },
    observedAt,
    providerId,
    providerRevision,
    recordedAt,
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
  state.providerKeys.set(providerKey, source.id);
  state.sources.set(recordKey(host, source.id), source);
  return clone(source);
});

const extractClaimImpl = Effect.fn("InMemoryAuthority.extractClaim")(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  sourceId: string,
  subjectId: string,
  typeId: string,
  predicate: string,
  value: Schema.Json,
  kind: ClaimKind
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const source = state.sources.get(recordKey(host, sourceId));
  if (!source) {
    return yield* reject("invalid_parameter");
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  const claim: PersistedClaim = {
    id: generatePrefixedId("clm", recordedAt),
    kind,
    predicate,
    recordedAt,
    sourceId: source.id,
    state: "proposed",
    subjectId,
    userId: host.userId,
    value,
    workspaceId: host.workspaceId,
  };
  state.claims.set(recordKey(host, claim.id), claim);
  ensureObject(state, host, subjectId, typeId, recordedAt);
  return clone(claim);
});

const acceptClaimImpl = Effect.fn("InMemoryAuthority.acceptClaim")(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  claimId: string
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const claim = state.claims.get(recordKey(host, claimId));
  if (claim?.state !== "proposed") {
    return yield* reject("invalid_parameter");
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  const accepted: PersistedClaim = { ...claim, state: "accepted", recordedAt };
  state.claims.set(recordKey(host, claimId), accepted);
  if (
    claim.kind === "interpretation" &&
    !isOperationalPredicate(claim.predicate)
  ) {
    projectAcceptedClaim(state, host, accepted, recordedAt);
  }
  return clone(accepted);
});

const getObjectImpl = Effect.fn("InMemoryAuthority.getObject")(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  objectId: string
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const snapshot = state.objects.get(recordKey(host, objectId));
  return snapshot ? clone(snapshot) : undefined;
});

const getObjectAtRevisionImpl = Effect.fn(
  "InMemoryAuthority.getObjectAtRevision"
)(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  objectId: string,
  revision: string
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const snapshot = state.revisions.get(
    `${recordKey(host, objectId)}\0${revision}`
  );
  return snapshot ? clone(snapshot) : undefined;
});

const queryEvidenceImpl = Effect.fn("InMemoryAuthority.queryEvidence")(
  function* (
    state: AuthorityState,
    scope: ActionHostBinding,
    subjectId: string
  ) {
    const host = yield* decodeScope(scope).pipe(
      Effect.mapError(() => reject("invalid_scope"))
    );
    const claims = [...state.claims.values()]
      .filter(
        (claim) =>
          claim.subjectId === subjectId &&
          claim.userId === host.userId &&
          claim.workspaceId === host.workspaceId
      )
      .map(clone);
    const sourceIds = new Set(claims.map((claim) => claim.sourceId));
    const sources = [...state.sources.values()]
      .filter(
        (source) =>
          sourceIds.has(source.id) &&
          source.userId === host.userId &&
          source.workspaceId === host.workspaceId
      )
      .map(clone);
    return { claims, sources } satisfies EvidenceQuery;
  }
);

const countSourcesImpl = Effect.fn("InMemoryAuthority.countSources")(function* (
  state: AuthorityState,
  scope: ActionHostBinding
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const prefix = `${scopeKey(host)}\0`;
  let count = 0;
  for (const key of state.sources.keys()) {
    if (key.startsWith(prefix)) count += 1;
  }
  return count;
});

const rememberIdentityImpl = Effect.fn("InMemoryAuthority.rememberIdentity")(
  function* (
    state: AuthorityState,
    scope: ActionHostBinding,
    handle: string,
    personId: string
  ) {
    const host = yield* decodeScope(scope).pipe(
      Effect.mapError(() => reject("invalid_scope"))
    );
    const recordedAt = yield* Clock.currentTimeMillis;
    ensureObject(state, host, personId, "person", recordedAt);
    const identity: ContactIdentity = {
      handle,
      id: generatePrefixedId("idn", recordedAt),
      personId,
      userId: host.userId,
      workspaceId: host.workspaceId,
    };
    state.identities.set(recordKey(host, identity.id), identity);
    return clone(identity);
  }
);

const proposeMergeImpl = Effect.fn("InMemoryAuthority.proposeMerge")(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  leftIdentityId: string,
  rightIdentityId: string,
  evidenceSourceId: string
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const left = state.identities.get(recordKey(host, leftIdentityId));
  const right = state.identities.get(recordKey(host, rightIdentityId));
  const evidence = state.sources.get(recordKey(host, evidenceSourceId));
  if (!left || !right) {
    return yield* reject("invalid_parameter");
  }
  if (!evidence) {
    return yield* reject("missing_evidence");
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  const merge: IdentityMerge = {
    evidenceSourceId: evidence.id,
    id: generatePrefixedId("mrg", recordedAt),
    leftIdentityId: left.id,
    leftPersonId: left.personId,
    rightIdentityId: right.id,
    rightPersonId: right.personId,
    status: "proposed",
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
  state.merges.set(recordKey(host, merge.id), merge);
  return clone(merge);
});

const acceptMergeImpl = Effect.fn("InMemoryAuthority.acceptMerge")(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  mergeId: string
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const merge = state.merges.get(recordKey(host, mergeId));
  if (merge?.status !== "proposed") {
    return yield* reject("invalid_parameter");
  }
  const left = state.identities.get(recordKey(host, merge.leftIdentityId));
  const right = state.identities.get(recordKey(host, merge.rightIdentityId));
  const evidence = state.sources.get(recordKey(host, merge.evidenceSourceId));
  if (!left || !right || !evidence) {
    return yield* reject("missing_evidence");
  }
  if (
    !sourceMentionsHandle(evidence, left.handle) ||
    !sourceMentionsHandle(evidence, right.handle)
  ) {
    return yield* reject("unsupported_match");
  }
  const merged: ContactIdentity = { ...right, personId: left.personId };
  state.identities.set(recordKey(host, right.id), merged);
  const accepted: IdentityMerge = { ...merge, status: "accepted" };
  state.merges.set(recordKey(host, mergeId), accepted);
  return clone(accepted);
});

const separateMergeImpl = Effect.fn("InMemoryAuthority.separateMerge")(
  function* (state: AuthorityState, scope: ActionHostBinding, mergeId: string) {
    const host = yield* decodeScope(scope).pipe(
      Effect.mapError(() => reject("invalid_scope"))
    );
    const merge = state.merges.get(recordKey(host, mergeId));
    if (merge?.status !== "accepted") {
      return yield* reject("invalid_parameter");
    }
    const right = state.identities.get(recordKey(host, merge.rightIdentityId));
    if (right) {
      state.identities.set(recordKey(host, right.id), {
        ...right,
        personId: merge.rightPersonId,
      });
    }
    const separated: IdentityMerge = { ...merge, status: "separated" };
    state.merges.set(recordKey(host, mergeId), separated);
    return clone(separated);
  }
);

const applyOperationalTransitionImpl = Effect.fn(
  "InMemoryAuthority.applyOperationalTransition"
)(function* (
  state: AuthorityState,
  scope: ActionHostBinding,
  objectId: string,
  status: string,
  expectedRevision: string
) {
  const host = yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
  const recordedAt = yield* Clock.currentTimeMillis;
  const current = ensureObject(state, host, objectId, "commitment", recordedAt);
  if (current.revision !== expectedRevision) {
    return yield* new AuthorityConflict({
      actualRevision: current.revision,
      expectedRevision,
      objectId,
    });
  }
  const next: ObjectSnapshot = {
    ...current,
    operationalStatus: status,
    recordedAt,
    revision: String(Number(current.revision) + 1),
  };
  const key = recordKey(host, objectId);
  state.objects.set(key, next);
  state.revisions.set(`${key}\0${next.revision}`, clone(next));
  return clone(next);
});

const listIdentitiesImpl = Effect.fn("InMemoryAuthority.listIdentities")(
  function* (
    state: AuthorityState,
    scope: ActionHostBinding,
    personId: string
  ) {
    const host = yield* decodeScope(scope).pipe(
      Effect.mapError(() => reject("invalid_scope"))
    );
    return [...state.identities.values()]
      .filter(
        (identity) =>
          identity.personId === personId &&
          identity.userId === host.userId &&
          identity.workspaceId === host.workspaceId
      )
      .map(clone);
  }
);

export class InMemoryAuthority {
  readonly #state: AuthorityState = {
    claims: new Map(),
    identities: new Map(),
    merges: new Map(),
    objects: new Map(),
    providerKeys: new Map(),
    revisions: new Map(),
    sources: new Map(),
  };

  admitSource(
    scope: ActionHostBinding,
    providerId: string,
    providerRevision: string,
    metadata: Readonly<Record<string, string>>,
    observedAt: number
  ) {
    return admitSourceImpl(
      this.#state,
      scope,
      providerId,
      providerRevision,
      metadata,
      observedAt
    );
  }

  extractClaim(
    scope: ActionHostBinding,
    sourceId: string,
    subjectId: string,
    typeId: string,
    predicate: string,
    value: Schema.Json,
    kind: ClaimKind
  ) {
    return extractClaimImpl(
      this.#state,
      scope,
      sourceId,
      subjectId,
      typeId,
      predicate,
      value,
      kind
    );
  }

  acceptClaim(scope: ActionHostBinding, claimId: string) {
    return acceptClaimImpl(this.#state, scope, claimId);
  }

  getObject(scope: ActionHostBinding, objectId: string) {
    return getObjectImpl(this.#state, scope, objectId);
  }

  getObjectAtRevision(
    scope: ActionHostBinding,
    objectId: string,
    revision: string
  ) {
    return getObjectAtRevisionImpl(this.#state, scope, objectId, revision);
  }

  queryEvidence(scope: ActionHostBinding, subjectId: string) {
    return queryEvidenceImpl(this.#state, scope, subjectId);
  }

  countSources(scope: ActionHostBinding) {
    return countSourcesImpl(this.#state, scope);
  }

  rememberIdentity(scope: ActionHostBinding, handle: string, personId: string) {
    return rememberIdentityImpl(this.#state, scope, handle, personId);
  }

  proposeMerge(
    scope: ActionHostBinding,
    leftIdentityId: string,
    rightIdentityId: string,
    evidenceSourceId: string
  ) {
    return proposeMergeImpl(
      this.#state,
      scope,
      leftIdentityId,
      rightIdentityId,
      evidenceSourceId
    );
  }

  acceptMerge(scope: ActionHostBinding, mergeId: string) {
    return acceptMergeImpl(this.#state, scope, mergeId);
  }

  separateMerge(scope: ActionHostBinding, mergeId: string) {
    return separateMergeImpl(this.#state, scope, mergeId);
  }

  listIdentities(scope: ActionHostBinding, personId: string) {
    return listIdentitiesImpl(this.#state, scope, personId);
  }

  applyOperationalTransition(
    scope: ActionHostBinding,
    objectId: string,
    status: string,
    expectedRevision: string
  ) {
    return applyOperationalTransitionImpl(
      this.#state,
      scope,
      objectId,
      status,
      expectedRevision
    );
  }
}
