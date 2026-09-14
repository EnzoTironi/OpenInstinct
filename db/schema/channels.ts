import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { session, user } from "./auth";

export const channelIdentities = pgTable(
  "channel_identity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: text("channel").notNull(),
    installationId: text("installation_id").notNull(),
    senderId: text("sender_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("channel_identity_sender_uidx")
      .on(table.channel, table.installationId, table.senderId)
      .where(sql`${table.revokedAt} IS NULL`),
    unique("channel_identity_installation_key").on(
      table.id,
      table.channel,
      table.installationId
    ),
    index("channel_identity_user_idx").on(table.userId),
    check(
      "channel_identity_channel_check",
      sql`${table.channel} IN ('telegram', 'kapso')`
    ),
    check(
      "channel_identity_address_check",
      sql`length(trim(${table.installationId})) > 0 AND length(trim(${table.senderId})) > 0`
    ),
  ]
);

export const channelPendingSenders = pgTable(
  "channel_pending_sender",
  {
    channel: text("channel").notNull(),
    installationId: text("installation_id").notNull(),
    senderId: text("sender_id").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    contactCount: integer("contact_count").default(1).notNull(),
    promptedAt: timestamp("prompted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: "channel_pending_sender_pkey",
      columns: [table.channel, table.installationId, table.senderId],
    }),
    check(
      "channel_pending_sender_channel_check",
      sql`${table.channel} IN ('telegram', 'kapso')`
    ),
    check(
      "channel_pending_sender_address_check",
      sql`length(trim(${table.installationId})) > 0 AND length(trim(${table.senderId})) > 0`
    ),
    check("channel_pending_sender_count_check", sql`${table.contactCount} > 0`),
    check(
      "channel_pending_sender_seen_check",
      sql`${table.lastSeenAt} >= ${table.firstSeenAt} AND (${table.promptedAt} IS NULL OR ${table.promptedAt} >= ${table.firstSeenAt})`
    ),
  ]
);

export const channelAuthChallenges = pgTable(
  "channel_auth_challenge",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    browserSecretHash: text("browser_secret_hash"),
    intendedIdentityId: uuid("intended_identity_id"),
    entryTokenHash: text("entry_token_hash"),
    browserBoundAt: timestamp("browser_bound_at", { withTimezone: true }),
    sourceSessionId: text("source_session_id"),
    sourceCallId: text("source_call_id"),
    targetUserId: text("target_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    sourceUserId: text("source_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    requestingSessionId: text("requesting_session_id").references(
      () => session.id,
      { onDelete: "cascade" }
    ),
    channel: text("channel").notNull(),
    installationId: text("installation_id").notNull(),
    identityId: uuid("identity_id"),
    confirmedSenderId: text("confirmed_sender_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("channel_auth_challenge_token_uidx").on(table.tokenHash),
    uniqueIndex("channel_auth_challenge_entry_uidx").on(table.entryTokenHash),
    uniqueIndex("channel_auth_challenge_native_source_uidx").on(
      table.intendedIdentityId,
      table.sourceSessionId,
      table.sourceCallId
    ),
    unique("channel_auth_challenge_installation_key").on(
      table.id,
      table.channel,
      table.installationId
    ),
    index("channel_auth_challenge_expiry_idx").on(table.expiresAt),
    foreignKey({
      name: "channel_auth_challenge_intended_identity_fkey",
      columns: [table.intendedIdentityId, table.channel, table.installationId],
      foreignColumns: [
        channelIdentities.id,
        channelIdentities.channel,
        channelIdentities.installationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "channel_auth_challenge_identity_fkey",
      columns: [table.identityId, table.channel, table.installationId],
      foreignColumns: [
        channelIdentities.id,
        channelIdentities.channel,
        channelIdentities.installationId,
      ],
    }).onDelete("cascade"),
    check(
      "channel_auth_challenge_archive_check",
      sql`${table.sourceUserId} IS NULL OR (${table.purpose} = 'link' AND ${table.intendedIdentityId} IS NOT NULL AND ${table.browserBoundAt} IS NOT NULL AND ${table.sourceUserId} <> ${table.targetUserId})`
    ),
    check(
      "channel_auth_challenge_channel_check",
      sql`${table.channel} IN ('telegram', 'kapso') AND length(trim(${table.installationId})) > 0`
    ),
    check(
      "channel_auth_challenge_purpose_check",
      sql`(${table.purpose} = 'login' AND ${table.targetUserId} IS NULL AND ${table.requestingSessionId} IS NULL) OR (
        ${table.purpose} = 'link' AND (
          (${table.intendedIdentityId} IS NOT NULL AND ${table.browserBoundAt} IS NULL
            AND ${table.targetUserId} IS NULL AND ${table.requestingSessionId} IS NULL)
          OR ((${table.intendedIdentityId} IS NULL OR ${table.browserBoundAt} IS NOT NULL)
            AND ${table.targetUserId} IS NOT NULL AND ${table.requestingSessionId} IS NOT NULL)
        )
      )`
    ),
    check(
      "channel_auth_challenge_hash_check",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$' AND (${table.browserSecretHash} IS NULL OR ${table.browserSecretHash} ~ '^[0-9a-f]{64}$') AND (${table.entryTokenHash} IS NULL OR ${table.entryTokenHash} ~ '^[0-9a-f]{64}$')`
    ),
    check(
      "channel_auth_challenge_native_check",
      sql`(
        ${table.intendedIdentityId} IS NULL
        AND ${table.entryTokenHash} IS NULL AND ${table.browserBoundAt} IS NULL
        AND ${table.sourceSessionId} IS NULL AND ${table.sourceCallId} IS NULL
        AND ${table.browserSecretHash} IS NOT NULL
      ) OR (
        ${table.intendedIdentityId} IS NOT NULL AND ${table.purpose} IN ('login', 'link')
        AND ${table.sourceSessionId} IS NOT NULL AND length(trim(${table.sourceSessionId})) > 0
        AND ${table.sourceCallId} IS NOT NULL AND length(trim(${table.sourceCallId})) > 0
        AND (
          (${table.browserBoundAt} IS NULL AND ${table.browserSecretHash} IS NULL
            AND ${table.entryTokenHash} IS NOT NULL AND ${table.confirmedAt} IS NULL)
          OR (${table.browserBoundAt} IS NOT NULL AND ${table.browserSecretHash} IS NOT NULL
            AND ${table.entryTokenHash} IS NULL AND ${table.browserBoundAt} >= ${table.createdAt}
            AND ${table.browserBoundAt} < ${table.expiresAt})
        )
        AND (${table.confirmedAt} IS NULL OR ${table.confirmedAt} >= ${table.browserBoundAt})
        AND (${table.identityId} IS NULL OR ${table.identityId} = ${table.intendedIdentityId})
      )`
    ),
    check(
      "channel_auth_challenge_confirmation_check",
      sql`(${table.confirmedAt} IS NULL AND ${table.confirmedSenderId} IS NULL) OR (${table.confirmedAt} IS NOT NULL AND ${table.confirmedSenderId} IS NOT NULL AND length(trim(${table.confirmedSenderId})) > 0)`
    ),
    check(
      "channel_auth_challenge_consumption_check",
      sql`${table.consumedAt} IS NULL OR (${table.confirmedAt} IS NOT NULL AND ${table.identityId} IS NOT NULL AND ${table.cancelledAt} IS NULL)`
    ),
    check(
      "channel_auth_challenge_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
  ]
);

export const channelAuthPrompts = pgTable(
  "channel_auth_prompt",
  {
    challengeId: uuid("challenge_id").primaryKey(),
    channel: text("channel").notNull(),
    installationId: text("installation_id").notNull(),
    senderId: text("sender_id").notNull(),
    eventId: text("event_id").notNull(),
    tokenCiphertext: text("token_ciphertext"),
    status: text("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "channel_auth_prompt_challenge_fkey",
      columns: [table.challengeId, table.channel, table.installationId],
      foreignColumns: [
        channelAuthChallenges.id,
        channelAuthChallenges.channel,
        channelAuthChallenges.installationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("channel_auth_prompt_event_uidx").on(
      table.channel,
      table.installationId,
      table.eventId
    ),
    index("channel_auth_prompt_dispatch_idx").on(table.status, table.createdAt),
    check(
      "channel_auth_prompt_status_check",
      sql`${table.status} IN ('queued', 'dispatching', 'sent', 'uncertain', 'failed', 'cancelled')`
    ),
    check("channel_auth_prompt_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "channel_auth_prompt_address_check",
      sql`length(trim(${table.senderId})) > 0 AND length(trim(${table.eventId})) > 0`
    ),
    check(
      "channel_auth_prompt_ciphertext_check",
      sql`(${table.status} IN ('queued', 'dispatching') AND ${table.tokenCiphertext} IS NOT NULL AND length(${table.tokenCiphertext}) BETWEEN 1 AND 8192) OR (${table.status} IN ('sent', 'uncertain', 'failed', 'cancelled') AND ${table.tokenCiphertext} IS NULL)`
    ),
    check(
      "channel_auth_prompt_lease_check",
      sql`(${table.status} = 'dispatching' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.status} <> 'dispatching' AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`
    ),
    check(
      "channel_auth_prompt_sent_check",
      sql`${table.status} <> 'sent' OR (${table.providerMessageId} IS NOT NULL AND ${table.sentAt} IS NOT NULL)`
    ),
    check(
      "channel_auth_prompt_error_check",
      sql`${table.lastError} IS NULL OR length(${table.lastError}) <= 100`
    ),
  ]
);
