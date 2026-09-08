import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { channelIdentities } from "./channels";

export const channelInbox = pgTable(
  "channel_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => channelIdentities.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    eventHash: text("event_hash").notNull(),
    payload: jsonb("payload").notNull(),
    sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    sessionId: text("session_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("channel_inbox_event_uidx").on(table.identityId, table.eventId),
    index("channel_inbox_dispatch_idx").on(
      table.identityId,
      table.status,
      table.sequence
    ),
    check(
      "channel_inbox_status_check",
      sql`${table.status} IN ('queued', 'dispatching', 'accepted', 'uncertain', 'failed')`
    ),
    check(
      "channel_inbox_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'object' AND length(trim(${table.eventId})) > 0 AND ${table.eventHash} ~ '^[0-9a-f]{64}$'`
    ),
    check("channel_inbox_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "channel_inbox_lease_check",
      sql`${table.status} <> 'dispatching' OR (${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`
    ),
    check(
      "channel_inbox_accepted_check",
      sql`${table.status} <> 'accepted' OR (${table.sessionId} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL)`
    ),
    check(
      "channel_inbox_error_check",
      sql`${table.lastError} IS NULL OR length(${table.lastError}) <= 200`
    ),
  ]
);

export const channelOutbox = pgTable(
  "channel_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => channelIdentities.id, { onDelete: "cascade" }),
    deliveryKey: text("delivery_key").notNull(),
    intentHash: text("intent_hash").notNull(),
    payload: jsonb("payload").notNull(),
    sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("channel_outbox_delivery_uidx").on(
      table.identityId,
      table.deliveryKey
    ),
    index("channel_outbox_dispatch_idx").on(
      table.identityId,
      table.status,
      table.sequence
    ),
    check(
      "channel_outbox_status_check",
      sql`${table.status} IN ('queued', 'dispatching', 'sent', 'uncertain', 'failed', 'cancelled')`
    ),
    check(
      "channel_outbox_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'object' AND length(trim(${table.deliveryKey})) > 0 AND ${table.intentHash} ~ '^[0-9a-f]{64}$'`
    ),
    check("channel_outbox_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "channel_outbox_lease_check",
      sql`${table.status} <> 'dispatching' OR (${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`
    ),
    check(
      "channel_outbox_sent_check",
      sql`${table.status} <> 'sent' OR (${table.providerMessageId} IS NOT NULL AND ${table.sentAt} IS NOT NULL)`
    ),
    check(
      "channel_outbox_error_check",
      sql`${table.lastError} IS NULL OR length(${table.lastError}) <= 200`
    ),
  ]
);
