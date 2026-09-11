import { createHash, randomUUID } from "node:crypto";

import type { PgClient } from "@effect/sql-pg";
import { Effect, Schema, Match } from "effect";

import {
  canonicalPayload,
  decodeReceipt,
  IdentityInactive,
  LeaseLost,
  MessagingStorageError,
  MessageClaimSchema,
  OutboxResolutionRejected,
  PayloadConflict,
  type DeliveryFailure,
  type Lease,
  type MessagePayload,
  type OutboxResolutionDecision,
  type ResolveOutboxUncertainInput,
} from "./model";

const decodeMessageClaimSchema = Schema.decodeUnknownEffect(MessageClaimSchema);

const decodeSchema_Array_Schema_Struct_status_Schema_String_co =
  Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({ status: Schema.String, count: Schema.Int }))
  );

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const queues = {
  inbox: {
    table: "channel_inbox",
    key: "event_id",
    hash: "event_hash",
    order: "sequence",
    result: "session_id",
    completedAt: "accepted_at",
    completed: "accepted",
  },
  outbox: {
    table: "channel_outbox",
    key: "delivery_key",
    hash: "intent_hash",
    order: "sequence",
    result: "provider_message_id",
    completedAt: "sent_at",
    completed: "sent",
  },
} as const;

export type Lane = keyof typeof queues;

interface QueueParts {
  readonly sql: PgClient.PgClient;
  readonly lane: Lane;
  readonly queue: (typeof queues)[Lane];
}

const queueTable = (parts: QueueParts) => parts.sql(parts.queue.table);

const queueSourceMessageId = (parts: QueueParts) =>
  parts.lane === "inbox" ? parts.sql`source_message_id` : parts.sql`NULL::text`;

const queueNativeInput = (parts: QueueParts) =>
  parts.lane === "inbox" ? parts.sql`native_input` : parts.sql`NULL::jsonb`;

const queueColumns = (parts: QueueParts) => {
  const { sql, queue } = parts;

  return sql`id, identity_id AS "identityId", ${sql(queue.key)} AS key,
    ${queueSourceMessageId(parts)} AS "sourceMessageId", payload, ${queueNativeInput(parts)} AS "nativeInput", status, attempts, lease_token AS "leaseToken",
    lease_expires_at::text AS "leaseExpiresAt", ${sql(queue.result)} AS "resultId",
    last_error AS "lastError"`;
};

const makeLockActive = (parts: QueueParts) =>
  Effect.fn("Messaging.lockActive")(function* (identityId: string) {
    const { sql } = parts;

    const rows = yield* sql<{
      active: boolean;
    }>`SELECT revoked_at IS NULL AS active
      FROM channel_identity WHERE id = ${identityId} FOR UPDATE`;

    if (!rows[0]?.active) return yield* new IdentityInactive({ identityId });

    return undefined;
  });

const intentHashForInsert = (
  lane: Lane,
  sourceMessageId: string | null,
  canonicalHash: string
) => {
  if (lane !== "inbox") return canonicalHash;

  return createHash("sha256")
    .update(encodeJson([sourceMessageId, canonicalHash]))
    .digest("hex");
};

const makeInsert = (
  parts: QueueParts,
  lockActive: ReturnType<typeof makeLockActive>
) => {
  const { sql, lane, queue } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.insert")(function* (input: {
    identityId: string;
    key: string;
    sourceMessageId: string | null;
    payload: MessagePayload;
  }) {
    yield* lockActive(input.identityId);
    const canonical = canonicalPayload(input.payload);

    const hash = intentHashForInsert(
      lane,
      input.sourceMessageId,
      canonical.hash
    );

    const existing = yield* sql<{ id: string; hash: string }>`
      SELECT id, ${sql(queue.hash)} AS hash FROM ${table}
      WHERE identity_id = ${input.identityId} AND ${sql(queue.key)} = ${input.key}`;

    const previous = existing[0];

    if (previous) {
      if (previous.hash !== hash) {
        return yield* new PayloadConflict({ id: previous.id });
      }

      const rows =
        yield* sql`SELECT ${columns} FROM ${table} WHERE id = ${previous.id}`;

      return yield* decodeReceipt(rows[0]);
    }

    const sourceColumn = lane === "inbox" ? sql`, source_message_id` : sql``;

    const sourceValue =
      lane === "inbox" ? sql`, ${input.sourceMessageId}` : sql``;

    const rows = yield* sql`INSERT INTO ${table}
      (id, identity_id, ${sql(queue.key)}, ${sql(queue.hash)}, payload, status${sourceColumn})
      VALUES (${randomUUID()}, ${input.identityId}, ${input.key}, ${hash},
        ${sql.json(canonical.payload)}, 'queued'${sourceValue}) RETURNING ${columns}`;

    return yield* decodeReceipt(rows[0]);
  }, sql.withTransaction);
};

const cancelQueuedOutbox = (parts: QueueParts, identityId: string) => {
  const { sql, lane } = parts;

  if (lane !== "outbox") return Effect.void;

  const table = queueTable(parts);

  return sql`UPDATE ${table} SET status = 'cancelled', last_error = 'identity_revoked'
          WHERE identity_id = ${identityId} AND status = 'queued'`;
};

const claimSnapshotFragment = (
  parts: QueueParts,
  channel: string,
  principalId: string
) => {
  const { sql, lane } = parts;

  if (lane !== "inbox") return sql``;

  return sql`, native_input = COALESCE(native_input, jsonb_build_object(
          'protocol', 'eve-keyed-input-v1', 'inputId', id::text,
          'channel', ${channel}::text, 'address', identity_id::text,
          'principalId', ${principalId}::text, 'content', NULL))`;
};

const makeClaim = (parts: QueueParts) => {
  const { sql, lane, queue } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.claim")(function* (
    identityId: string,
    leaseSeconds: number
  ) {
    const identities = yield* sql<{
      active: boolean;
      channel: string;
      principalId: string;
    }>`SELECT revoked_at IS NULL AS active, channel, 'better-auth:' || user_id AS "principalId"
      FROM channel_identity WHERE id = ${identityId} FOR UPDATE SKIP LOCKED`;

    if (!identities[0]) return null;
    yield* sql`UPDATE ${table} SET status = 'uncertain', last_error = 'lease_expired',
      lease_token = NULL, lease_expires_at = NULL
      WHERE identity_id = ${identityId} AND status = 'dispatching'
        AND lease_expires_at <= clock_timestamp()`;

    if (!identities[0].active) {
      yield* cancelQueuedOutbox(parts, identityId);

      return null;
    }

    const recoverable =
      lane === "inbox" ? sql`native_input IS NOT NULL` : sql`FALSE`;

    const blocked =
      yield* sql`SELECT id FROM ${table} WHERE identity_id = ${identityId}
      AND (status = 'dispatching' OR (status = 'uncertain' AND NOT (${recoverable}))) LIMIT 1`;

    if (blocked.length > 0) return null;

    const snapshot = claimSnapshotFragment(
      parts,
      identities[0].channel,
      identities[0].principalId
    );

    // lease_expires_at on queued rows is a not-before time for rate-limit deferral.
    const rows =
      yield* sql`UPDATE ${table} SET status = 'dispatching'${snapshot},
        attempts = attempts + 1, lease_token = ${randomUUID()},
        lease_expires_at = clock_timestamp() + ${leaseSeconds} * interval '1 second'
      WHERE id = (SELECT id FROM ${table} WHERE identity_id = ${identityId}
        AND (status = 'queued' OR (status = 'uncertain' AND (${recoverable})))
        ORDER BY ${sql(queue.order)}, id
        LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
      RETURNING ${columns}`;

    if (!rows[0]) return null;

    return yield* decodeMessageClaimSchema(rows[0]);
  }, sql.withTransaction);
};

const makeRequireLease = (
  parts: QueueParts,
  lockActive: ReturnType<typeof makeLockActive>
) => {
  const { sql } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.requireLease")(function* (lease: Lease) {
    yield* lockActive(lease.identityId);

    const rows = yield* sql`SELECT ${columns} FROM ${table}
      WHERE id = ${lease.id} AND identity_id = ${lease.identityId}
        AND status = 'dispatching' AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() FOR UPDATE`;

    if (!rows[0]) return yield* new LeaseLost({ id: lease.id });

    return yield* decodeReceipt(rows[0]);
  });
};

const makeComplete = (
  parts: QueueParts,
  requireLease: ReturnType<typeof makeRequireLease>
) => {
  const { sql, queue } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.complete")(function* (
    lease: Lease,
    resultId: string
  ) {
    yield* requireLease(lease);

    const rows = yield* sql`UPDATE ${table} SET status = ${queue.completed},
      ${sql(queue.result)} = ${resultId}, ${sql(queue.completedAt)} = clock_timestamp(),
      lease_token = NULL, lease_expires_at = NULL, last_error = NULL
      WHERE id = ${lease.id} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() RETURNING ${columns}`;

    if (!rows[0]) return yield* new LeaseLost({ id: lease.id });

    return yield* decodeReceipt(rows[0]);
  }, sql.withTransaction);
};

const makeStop = (
  parts: QueueParts,
  requireLease: ReturnType<typeof makeRequireLease>
) => {
  const { sql } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.stop")(function* (
    lease: Lease,
    status: "uncertain" | "failed",
    reason: DeliveryFailure
  ) {
    yield* requireLease(lease);

    const rows =
      yield* sql`UPDATE ${table} SET status = ${status}, last_error = ${reason},
      lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${lease.id} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() RETURNING ${columns}`;

    if (!rows[0]) return yield* new LeaseLost({ id: lease.id });

    return yield* decodeReceipt(rows[0]);
  }, sql.withTransaction);
};

const makeLoadUncertainRow = (parts: QueueParts) => {
  const { sql } = parts;
  const table = queueTable(parts);

  return Effect.fn("Messaging.loadUncertainRow")(function* (
    input: ResolveOutboxUncertainInput
  ) {
    const current = yield* sql<{
      id: string;
      status: string;
      lastError: string | null;
      resultId: string | null;
    }>`SELECT id, status, last_error AS "lastError",
        provider_message_id AS "resultId"
      FROM ${table}
      WHERE id = ${input.id} AND identity_id = ${input.identityId}
      FOR UPDATE`;

    return current[0];
  });
};

interface UncertainRow {
  readonly status: string;
  readonly lastError: string | null;
  readonly resultId: string | null;
}

const isIdempotentDelivered = (
  decision: OutboxResolutionDecision,
  row: UncertainRow
) =>
  decision.kind === "mark_delivered" &&
  row.status === "sent" &&
  row.resultId === decision.providerMessageId;

const isIdempotentCancel = (
  decision: OutboxResolutionDecision,
  row: UncertainRow
) =>
  decision.kind === "cancel" &&
  row.status === "cancelled" &&
  row.lastError === decision.reason;

const isIdempotentRetry = (
  decision: OutboxResolutionDecision,
  row: UncertainRow
) =>
  decision.kind === "authorize_retry" &&
  row.status === "queued" &&
  row.lastError === "duplicate_retry_authorized";

const makeResolveIdempotentSettled = (parts: QueueParts) => {
  const { sql } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.resolveIdempotentSettled")(function* (
    input: ResolveOutboxUncertainInput,
    row: UncertainRow,
    decision: OutboxResolutionDecision
  ) {
    if (isIdempotentDelivered(decision, row)) {
      const existing =
        yield* sql`SELECT ${columns} FROM ${table} WHERE id = ${input.id}`;

      return yield* decodeReceipt(existing[0]);
    }

    if (isIdempotentCancel(decision, row)) {
      const existing =
        yield* sql`SELECT ${columns} FROM ${table} WHERE id = ${input.id}`;

      return yield* decodeReceipt(existing[0]);
    }

    if (isIdempotentRetry(decision, row)) {
      const existing =
        yield* sql`SELECT ${columns} FROM ${table} WHERE id = ${input.id}`;

      return yield* decodeReceipt(existing[0]);
    }

    return yield* new OutboxResolutionRejected({
      id: input.id,
      reason: "not_uncertain",
    });
  });
};

const rejectConflict = (id: string) =>
  new OutboxResolutionRejected({
    id,
    reason: "conflict",
  });

const applyMarkDelivered = (
  parts: QueueParts,
  input: ResolveOutboxUncertainInput,
  decision: Extract<OutboxResolutionDecision, { kind: "mark_delivered" }>
) => {
  const { sql } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.gen(function* () {
    const rows = yield* sql`UPDATE ${table} SET status = 'sent',
        provider_message_id = ${decision.providerMessageId},
        sent_at = clock_timestamp(),
        lease_token = NULL, lease_expires_at = NULL, last_error = NULL
        WHERE id = ${input.id} AND status = 'uncertain'
        RETURNING ${columns}`;

    if (!rows[0]) return yield* rejectConflict(input.id);

    return yield* decodeReceipt(rows[0]);
  });
};

const applyCancelDecision = (
  parts: QueueParts,
  input: ResolveOutboxUncertainInput,
  decision: Extract<OutboxResolutionDecision, { kind: "cancel" }>
) => {
  const { sql } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.gen(function* () {
    const rows = yield* sql`UPDATE ${table} SET status = 'cancelled',
        last_error = ${decision.reason},
        lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${input.id} AND status = 'uncertain'
        RETURNING ${columns}`;

    if (!rows[0]) return yield* rejectConflict(input.id);

    return yield* decodeReceipt(rows[0]);
  });
};

const applyAuthorizeRetry = (
  parts: QueueParts,
  input: ResolveOutboxUncertainInput
) => {
  const { sql } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.gen(function* () {
    const rows = yield* sql`UPDATE ${table} SET status = 'queued',
      last_error = 'duplicate_retry_authorized',
      lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${input.id} AND status = 'uncertain'
      RETURNING ${columns}`;

    if (!rows[0]) return yield* rejectConflict(input.id);

    return yield* decodeReceipt(rows[0]);
  });
};

const makeApplyUncertainDecision = (parts: QueueParts) => {
  const { sql } = parts;

  return Effect.fn("Messaging.applyUncertainDecision")(function* (
    input: ResolveOutboxUncertainInput,
    row: { readonly lastError: string | null },
    decision: OutboxResolutionDecision,
    detail: string
  ) {
    yield* sql`INSERT INTO channel_outbox_resolution
      (id, outbox_id, identity_id, decision, detail, prior_status, prior_error,
       actor_principal_id, note)
      VALUES (
        ${randomUUID()},
        ${input.id},
        ${input.identityId},
        ${decision.kind},
        ${detail},
        'uncertain',
        ${row.lastError},
        ${input.actorPrincipalId},
        ${input.note ?? null}
      )`;

    if (decision.kind === "mark_delivered") {
      return yield* applyMarkDelivered(parts, input, decision);
    }

    if (decision.kind === "cancel") {
      return yield* applyCancelDecision(parts, input, decision);
    }

    return yield* applyAuthorizeRetry(parts, input);
  });
};

const decisionDetail = (decision: OutboxResolutionDecision) =>
  Match.value(decision).pipe(
    Match.when({ kind: "mark_delivered" }, (d) => d.providerMessageId),
    Match.when({ kind: "cancel" }, (d) => d.reason),
    Match.orElse((d) => d.acknowledgment)
  );

const lockIdentityForCancel = (
  parts: QueueParts,
  input: ResolveOutboxUncertainInput
) => {
  const { sql } = parts;

  return Effect.gen(function* () {
    const rows = yield* sql<{
      active: boolean;
    }>`SELECT revoked_at IS NULL AS active
        FROM channel_identity WHERE id = ${input.identityId} FOR UPDATE`;

    if (!rows[0]) {
      return yield* new OutboxResolutionRejected({
        id: input.id,
        reason: "identity_inactive",
      });
    }

    return undefined;
  });
};

const makeResolveUncertain = (deps: {
  readonly parts: QueueParts;
  readonly lockActive: ReturnType<typeof makeLockActive>;
  readonly loadUncertainRow: ReturnType<typeof makeLoadUncertainRow>;
  readonly resolveIdempotentSettled: ReturnType<
    typeof makeResolveIdempotentSettled
  >;
  readonly applyUncertainDecision: ReturnType<
    typeof makeApplyUncertainDecision
  >;
}) => {
  const {
    parts,
    lockActive,
    loadUncertainRow,
    resolveIdempotentSettled,
    applyUncertainDecision,
  } = deps;

  const { sql, lane } = parts;

  return Effect.fn("Messaging.resolveUncertain")(function* (
    input: ResolveOutboxUncertainInput
  ) {
    if (lane !== "outbox") {
      return yield* new OutboxResolutionRejected({
        id: input.id,
        reason: "not_uncertain",
      });
    }

    const decision: OutboxResolutionDecision = input.decision;

    // Cancel may clear a revoked identity's stuck uncertain row; delivery/retry
    // still require an active identity because they assert or risk an effect.
    if (decision.kind !== "cancel") {
      yield* lockActive(input.identityId);
    } else {
      yield* lockIdentityForCancel(parts, input);
    }

    const row = yield* loadUncertainRow(input);

    if (!row) {
      return yield* new OutboxResolutionRejected({
        id: input.id,
        reason: "not_uncertain",
      });
    }

    const detail = decisionDetail(decision);

    if (row.status !== "uncertain") {
      return yield* resolveIdempotentSettled(input, row, decision);
    }

    return yield* applyUncertainDecision(input, row, decision, detail);
  }, sql.withTransaction);
};

const makeScheduleRetry = (
  parts: QueueParts,
  requireLease: ReturnType<typeof makeRequireLease>
) => {
  const { sql } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.scheduleRetry")(function* (
    lease: Lease,
    retryAfterSeconds: number
  ) {
    yield* requireLease(lease);
    const seconds = Math.min(Math.max(Math.floor(retryAfterSeconds), 1), 3_600);

    const rows =
      yield* sql`UPDATE ${table} SET status = 'queued', last_error = 'adapter_rate_limited',
      lease_token = NULL,
      lease_expires_at = clock_timestamp() + ${seconds} * interval '1 second'
      WHERE id = ${lease.id} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() RETURNING ${columns}`;

    if (!rows[0]) return yield* new LeaseLost({ id: lease.id });

    return yield* decodeReceipt(rows[0]);
  }, sql.withTransaction);
};

const makeInspect = (parts: QueueParts) => {
  const { sql, queue } = parts;
  const table = queueTable(parts);
  const columns = queueColumns(parts);

  return Effect.fn("Messaging.inspect")(function* (identityId: string) {
    const counts =
      yield* sql`SELECT status, count(*)::int AS count FROM ${table}
      WHERE identity_id = ${identityId} GROUP BY status ORDER BY status`;

    const pending = yield* sql`SELECT ${columns} FROM ${table}
      WHERE identity_id = ${identityId} AND status = 'uncertain'
      ORDER BY ${sql(queue.order)}, id LIMIT 100`;

    const decodedCounts =
      yield* decodeSchema_Array_Schema_Struct_status_Schema_String_co(counts);

    return {
      counts: decodedCounts,
      uncertain: yield* Effect.forEach(pending, (row) => decodeReceipt(row), {
        concurrency: 1,
      }),
    };
  });
};

export const createQueue = (sql: PgClient.PgClient, lane: Lane) => {
  const parts: QueueParts = { sql, lane, queue: queues[lane] };
  const lockActive = makeLockActive(parts);
  const requireLease = makeRequireLease(parts, lockActive);
  const loadUncertainRow = makeLoadUncertainRow(parts);
  const resolveIdempotentSettled = makeResolveIdempotentSettled(parts);
  const applyUncertainDecision = makeApplyUncertainDecision(parts);

  return {
    insert: makeInsert(parts, lockActive),
    claim: makeClaim(parts),
    complete: makeComplete(parts, requireLease),
    stop: makeStop(parts, requireLease),
    resolveUncertain: makeResolveUncertain({
      parts,
      lockActive,
      loadUncertainRow,
      resolveIdempotentSettled,
      applyUncertainDecision,
    }),
    scheduleRetry: makeScheduleRetry(parts, requireLease),
    inspect: makeInspect(parts),
    checkLease: (lease: Lease) => sql.withTransaction(requireLease(lease)),
  };
};

export const storageFailure = () =>
  new MessagingStorageError({ message: "Messaging storage operation failed." });
