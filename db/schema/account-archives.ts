import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces } from "./workspaces";

export const accountArchives = pgTable(
  "account_archive",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceUserId: text("source_user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "restrict" }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    workspaceId: text("workspace_id")
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    challengeId: uuid("challenge_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("account_archive_target_idx").on(table.targetUserId),
    check(
      "account_archive_distinct_users",
      sql`${table.sourceUserId} <> ${table.targetUserId}`
    ),
  ]
);
