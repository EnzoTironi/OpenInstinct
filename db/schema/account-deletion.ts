import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountDeletionRequests = pgTable(
  "account_deletion_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    blockedReason: text("blocked_reason"),
    backupExpiresAt: timestamp("backup_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("account_deletion_requests_user_uidx").on(table.userId),
    check(
      "account_deletion_requests_status_check",
      sql`${table.status} IN ('blocked', 'pending_external', 'completed')`
    ),
    check(
      "account_deletion_requests_blocked_check",
      sql`(${table.status} = 'blocked' AND ${table.blockedReason} = 'sole_owner' AND ${table.completedAt} IS NULL)
        OR (${table.status} IN ('pending_external', 'completed') AND ${table.blockedReason} IS NULL AND ${table.completedAt} IS NOT NULL AND ${table.backupExpiresAt} IS NOT NULL)`
    ),
  ]
);

export const accountDeletionLedger = pgTable(
  "account_deletion_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => accountDeletionRequests.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    status: text("status").notNull(),
  },
  (table) => [
    uniqueIndex("account_deletion_ledger_surface_uidx").on(
      table.requestId,
      table.surface
    ),
    check(
      "account_deletion_ledger_status_check",
      sql`${table.status} IN ('erased', 'retained_company', 'pending_external', 'backup_held')`
    ),
  ]
);

export const accountDeletionTombstones = pgTable(
  "account_deletion_tombstones",
  {
    userId: text("user_id").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => accountDeletionRequests.id, { onDelete: "cascade" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("account_deletion_tombstones_deleted_idx").on(table.deletedAt),
  ]
);
