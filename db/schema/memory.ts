import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces";

export const memoryDocuments = pgTable(
  "memory_document",
  {
    key: text("key").primaryKey(),
    content: text("content").notNull(),
    version: uuid("version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "memory_document_key_check",
      sql`length(${table.key}) BETWEEN 1 AND 512 AND trim(${table.key}) = ${table.key}`
    ),
    check(
      "memory_document_content_check",
      sql`length(${table.content}) <= 4000`
    ),
  ]
);

export const personalMemoryBindings = pgTable(
  "personal_memory_binding",
  {
    key: text("key").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    namespace: text("namespace").notNull(),
    slot: text("slot").notNull(),
  },
  (table) => [
    check(
      "personal_memory_binding_key_check",
      sql`length(${table.key}) BETWEEN 1 AND 512 AND trim(${table.key}) = ${table.key}`
    ),
    check(
      "personal_memory_binding_namespace_check",
      sql`octet_length(${table.namespace}) BETWEEN 1 AND 1024`
    ),
    check("personal_memory_binding_slot_check", sql`${table.slot} = 'profile'`),
    unique("personal_memory_binding_workspace_namespace_slot_unique").on(
      table.workspaceId,
      table.namespace,
      table.slot
    ),
  ]
);
