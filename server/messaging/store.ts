import { createHash, randomUUID } from "node:crypto";
import type { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import {
  canonicalPayload,
  decodeReceipt,
  IdentityInactive,
  LeaseLost,
  MessagingStorageError,
  MessageClaimSchema,
  PayloadConflict,
  type DeliveryFailure,
  type Lease,
  type MessagePayload,
} from "./model";

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
    order: "created_at",
    result: "provider_message_id",
    completedAt: "sent_at",
    completed: "sent",
  },
} as const;
export type Lane = keyof typeof queues;

export const makeQueue = (sql: PgClient.PgClient, lane: Lane) => {
  const queue = queues[lane];
  const table = sql(queue.table);
  const sourceMessageId =
    lane === "inbox" ? sql`source_message_id` : sql`NULL::text`;
  const columns = sql`id, identity_id AS "identityId", ${sql(queue.key)} AS key,
    ${sourceMessageId} AS "sourceMessageId", payload, status, attempts, lease_token AS "leaseToken",
    lease_expires_at::text AS "leaseExpiresAt", ${sql(queue.result)} AS "resultId",
    last_error AS "lastError"`;

  const lockActive = Effect.fn("Messaging.lockActive")(function* (
    identityId: string
  ) {
    const rows = yield* sql<{
      active: boolean;
    }>`SELECT revoked_at IS NULL AS active
      FROM channel_identity WHERE id = ${identityId} FOR UPDATE`;
    if (!rows[0]?.active) return yield* new IdentityInactive({ identityId });
    return undefined;
  });

  const insert = Effect.fn("Messaging.insert")(function* (input: {
    identityId: string;
    key: string;
    sourceMessageId: string | null;
    payload: MessagePayload;
  }) {
    yield* lockActive(input.identityId);
    const canonical = canonicalPayload(input.payload);
    const hash =
      lane === "inbox"
        ? createHash("sha256")
            .update(JSON.stringify([input.sourceMessageId, canonical.hash]))
            .digest("hex")
        : canonical.hash;
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

  const claim = Effect.fn("Messaging.claim")(function* (
    identityId: string,
    leaseSeconds: number
  ) {
    const identities = yield* sql<{
      active: boolean;
    }>`SELECT revoked_at IS NULL AS active
      FROM channel_identity WHERE id = ${identityId} FOR UPDATE SKIP LOCKED`;
    if (!identities[0]) return null;
    yield* sql`UPDATE ${table} SET status = 'uncertain', last_error = 'lease_expired',
      lease_token = NULL, lease_expires_at = NULL
      WHERE identity_id = ${identityId} AND status = 'dispatching'
        AND lease_expires_at <= clock_timestamp()`;
    if (!identities[0].active) {
      if (lane === "outbox") {
        yield* sql`UPDATE ${table} SET status = 'cancelled', last_error = 'identity_revoked'
          WHERE identity_id = ${identityId} AND status = 'queued'`;
      }
      return null;
    }
    const blocked =
      yield* sql`SELECT id FROM ${table} WHERE identity_id = ${identityId}
      AND status IN ('dispatching', 'uncertain') LIMIT 1`;
    if (blocked.length > 0) return null;
    const rows = yield* sql`UPDATE ${table} SET status = 'dispatching',
        attempts = attempts + 1, lease_token = ${randomUUID()},
        lease_expires_at = clock_timestamp() + ${leaseSeconds} * interval '1 second'
      WHERE id = (SELECT id FROM ${table} WHERE identity_id = ${identityId}
        AND status = 'queued' ORDER BY ${sql(queue.order)}, id
        LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING ${columns}`;
    return rows[0]
      ? yield* Schema.decodeUnknownEffect(MessageClaimSchema)(rows[0])
      : null;
  }, sql.withTransaction);

  const requireLease = Effect.fn("Messaging.requireLease")(function* (
    lease: Lease
  ) {
    yield* lockActive(lease.identityId);
    const rows = yield* sql`SELECT ${columns} FROM ${table}
      WHERE id = ${lease.id} AND identity_id = ${lease.identityId}
        AND status = 'dispatching' AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() FOR UPDATE`;
    if (!rows[0]) return yield* new LeaseLost({ id: lease.id });
    return yield* decodeReceipt(rows[0]);
  });

  const complete = Effect.fn("Messaging.complete")(function* (
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

  const stop = Effect.fn("Messaging.stop")(function* (
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

  const inspect = Effect.fn("Messaging.inspect")(function* (
    identityId: string
  ) {
    const counts =
      yield* sql`SELECT status, count(*)::int AS count FROM ${table}
      WHERE identity_id = ${identityId} GROUP BY status ORDER BY status`;
    const pending = yield* sql`SELECT ${columns} FROM ${table}
      WHERE identity_id = ${identityId} AND status = 'uncertain'
      ORDER BY ${sql(queue.order)}, id LIMIT 100`;
    const decodedCounts = yield* Schema.decodeUnknownEffect(
      Schema.Array(Schema.Struct({ status: Schema.String, count: Schema.Int }))
    )(counts);
    return {
      counts: decodedCounts,
      uncertain: yield* Effect.forEach(pending, (row) => decodeReceipt(row)),
    };
  });

  return {
    insert,
    claim,
    complete,
    stop,
    inspect,
    checkLease: (lease: Lease) => sql.withTransaction(requireLease(lease)),
  };
};

export const storageFailure = () =>
  new MessagingStorageError({ message: "Messaging storage operation failed." });
