import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaceGroupBindings } from "./workspace-agents";

export const matrixIdentities = pgTable("matrix_identities", {
  userId: text("user_id").primaryKey(),
  matrixId: text("matrix_id").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
});
export const matrixRoomMembers = pgTable(
  "matrix_room_members",
  {
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => workspaceGroupBindings.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => matrixIdentities.userId, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.bindingId, t.userId] })]
);
export const matrixTransactions = pgTable("matrix_transactions", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const matrixReceivedEvents = pgTable("matrix_received_events", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const matrixDeliveries = pgTable(
  "matrix_deliveries",
  {
    eventId: text("event_id").primaryKey(),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => workspaceGroupBindings.id, { onDelete: "cascade" }),
    epoch: uuid("epoch").notNull(),
    userId: text("user_id").notNull(),
    message: text("message").notNull(),
    prompt: text("prompt"),
    sessionId: text("session_id"),
    state: text("state").notNull().default("pending"),
    output: text("output"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "matrix_deliveries_state_check",
      sql`${t.state} IN ('pending', 'dispatched', 'answer_ready', 'completed', 'suppressed', 'failed')`
    ),
    index("matrix_deliveries_pending_idx").on(t.state, t.createdAt),
  ]
);
