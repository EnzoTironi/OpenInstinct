import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
