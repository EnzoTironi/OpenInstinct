import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const whatsappBridgeAccounts = pgTable(
  "whatsapp_bridge_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    pairingNonceHash: text("pairing_nonce_hash").notNull(),
    remoteUserId: text("remote_user_id"),
    matrixUserId: text("matrix_user_id"),
    loginId: text("login_id"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "whatsapp_bridge_accounts_status_check",
      sql`(${table.status} = 'pairing' AND ${table.remoteUserId} IS NULL AND ${table.revokedAt} IS NULL)
        OR (${table.status} IN ('connected', 'paused') AND ${table.remoteUserId} IS NOT NULL AND ${table.matrixUserId} IS NOT NULL AND ${table.revokedAt} IS NULL)
        OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`
    ),
    uniqueIndex("whatsapp_bridge_accounts_workspace_uidx")
      .on(table.workspaceId)
      .where(sql`${table.revokedAt} IS NULL`),
    uniqueIndex("whatsapp_bridge_accounts_remote_uidx")
      .on(table.remoteUserId)
      .where(
        sql`${table.remoteUserId} IS NOT NULL AND ${table.revokedAt} IS NULL`
      ),
  ]
);

export const whatsappBridgeChats = pgTable(
  "whatsapp_bridge_chats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => whatsappBridgeAccounts.id, { onDelete: "cascade" }),
    remoteChatId: text("remote_chat_id").notNull(),
    matrixRoomId: text("matrix_room_id"),
    kind: text("kind").notNull(),
    lastBackfillAt: timestamp("last_backfill_at", { withTimezone: true }),
    lastLiveAt: timestamp("last_live_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "whatsapp_bridge_chats_kind_check",
      sql`${table.kind} IN ('dm', 'group')`
    ),
    uniqueIndex("whatsapp_bridge_chats_live_uidx")
      .on(table.accountId, table.remoteChatId)
      .where(sql`${table.revokedAt} IS NULL`),
    uniqueIndex("whatsapp_bridge_chats_room_uidx")
      .on(table.matrixRoomId)
      .where(
        sql`${table.matrixRoomId} IS NOT NULL AND ${table.revokedAt} IS NULL`
      ),
    index("whatsapp_bridge_chats_account_idx").on(table.accountId),
  ]
);

export const whatsappBridgeShares = pgTable(
  "whatsapp_bridge_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => whatsappBridgeChats.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    issuedBy: text("issued_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_bridge_shares_live_uidx")
      .on(table.chatId, table.workspaceId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("whatsapp_bridge_shares_workspace_idx").on(table.workspaceId),
  ]
);

export const whatsappBridgeEvents = pgTable(
  "whatsapp_bridge_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => whatsappBridgeAccounts.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => whatsappBridgeChats.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id").notNull(),
    matrixEventId: text("matrix_event_id"),
    kind: text("kind").notNull(),
    authorRemoteId: text("author_remote_id").notNull(),
    body: text("body").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "whatsapp_bridge_events_kind_check",
      sql`${table.kind} IN ('backfill', 'live')`
    ),
    uniqueIndex("whatsapp_bridge_events_provider_uidx").on(
      table.accountId,
      table.providerEventId
    ),
    index("whatsapp_bridge_events_chat_idx").on(table.chatId, table.occurredAt),
  ]
);

export const whatsappBridgeDrafts = pgTable(
  "whatsapp_bridge_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => whatsappBridgeAccounts.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => whatsappBridgeChats.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorizedBody: text("authorized_body"),
    authorizedChatId: uuid("authorized_chat_id"),
    status: text("status").notNull(),
    issuedBy: text("issued_by").notNull(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "whatsapp_bridge_drafts_status_check",
      sql`${table.status} IN ('draft', 'authorized', 'queued', 'cancelled')`
    ),
    foreignKey({
      name: "whatsapp_bridge_drafts_authorized_chat_id_fkey",
      columns: [table.authorizedChatId],
      foreignColumns: [whatsappBridgeChats.id],
    }).onDelete("cascade"),
    index("whatsapp_bridge_drafts_account_idx").on(table.accountId),
  ]
);

export const whatsappBridgeContacts = pgTable(
  "whatsapp_bridge_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => whatsappBridgeAccounts.id, { onDelete: "cascade" }),
    remoteUserId: text("remote_user_id").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_bridge_contacts_remote_uidx").on(
      table.accountId,
      table.remoteUserId
    ),
  ]
);
