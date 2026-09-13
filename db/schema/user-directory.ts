import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces } from "./workspaces";

export const userDirectory = pgTable(
  "user_directory",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    username: text("username").notNull().unique(),
    discoverable: boolean("discoverable").notNull().default(false),
  },
  (table) => [
    check(
      "user_directory_username_check",
      sql`${table.username} ~ '^[a-z][a-z0-9_]{2,29}$'`
    ),
  ]
);

export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted", "revoked"] })
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "workspace_invites_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'revoked')`
    ),
    index("workspace_invites_recipient_idx").on(
      table.targetUserId,
      table.status
    ),
    uniqueIndex("workspace_invites_pending_idx")
      .on(table.workspaceId, table.targetUserId)
      .where(sql`${table.status} = 'pending'`),
  ]
);
