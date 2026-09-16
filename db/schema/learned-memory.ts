import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
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

export const workspaceLearnedItems = pgTable(
  "workspace_learned_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => workspaceMemoryNamespaces.namespaceId, {
        onDelete: "cascade",
      }),
    typeId: text("type_id").notNull(),
    memory: text("memory").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("workspace_learned_item_namespace_idx").on(
      table.namespaceId,
      table.typeId
    ),
    check(
      "workspace_learned_item_memory_check",
      sql`length(${table.memory}) > 0 AND length(${table.memory}) <= 8000`
    ),
    check(
      "workspace_learned_item_type_check",
      sql`length(trim(${table.typeId})) > 0 AND length(${table.typeId}) <= 128`
    ),
  ]
);
