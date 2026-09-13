import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const workspaceMemoryErasures = pgTable("workspace_memory_erasure", {
  namespaceId: uuid("namespace_id").primaryKey(),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaceMemoryNamespaces = pgTable(
  "workspace_memory_namespace",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    namespaceId: uuid("namespace_id").notNull().defaultRandom().unique(),
    enabled: boolean("enabled").notNull().default(true),
    eveScopeKey: text("eve_scope_key").unique(),
    pendingOperation: text("pending_operation"),
    pendingHash: text("pending_hash"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })]
);

export const workspaceMemoryRecalls = pgTable(
  "workspace_memory_recall",
  {
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => workspaceMemoryNamespaces.namespaceId, {
        onDelete: "cascade",
      }),
    operationId: text("operation_id").notNull(),
    snapshot: jsonb("snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.namespaceId, table.operationId] })]
);
