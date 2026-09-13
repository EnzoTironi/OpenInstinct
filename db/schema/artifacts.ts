import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { channelIdentities } from "./channels";
import { channelInbox } from "./messaging";
import { workspaces } from "./workspaces";
import { bytea } from "./binary";

export const privateArtifacts = pgTable(
  "private_artifact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceIdentityId: uuid("source_identity_id")
      .notNull()
      .references(() => channelIdentities.id, { onDelete: "cascade" }),
    sourceInboxId: uuid("source_inbox_id")
      .notNull()
      .references(() => channelInbox.id, { onDelete: "cascade" }),
    sourceEventId: text("source_event_id").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    sourceMediaId: text("source_media_id").notNull(),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    content: bytea("content"),
    derivedText: text("derived_text"),
    derivedKind: text("derived_kind"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("private_artifact_source_unique").on(
      table.sourceIdentityId,
      table.sourceEventId,
      table.sourceMediaId
    ),
    index("private_artifact_owner_created_idx")
      .on(
        table.workspaceId,
        table.ownerUserId,
        table.createdAt.desc(),
        table.id.desc()
      )
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "private_artifact_length",
      sql`${table.byteLength} BETWEEN 1 AND 10485760`
    ),
    check("private_artifact_hash", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "private_artifact_content",
      sql`(${table.deletedAt} IS NULL AND ${table.content} IS NOT NULL AND octet_length(${table.content}) = ${table.byteLength})
        OR (${table.deletedAt} IS NOT NULL AND ${table.content} IS NULL AND ${table.derivedText} IS NULL AND ${table.derivedKind} IS NULL)`
    ),
    check(
      "private_artifact_derived",
      sql`(${table.derivedText} IS NULL AND ${table.derivedKind} IS NULL)
        OR (${table.derivedText} IS NOT NULL AND octet_length(${table.derivedText}) <= 65536 AND ${table.derivedKind} IS NOT NULL AND ${table.derivedKind} IN ('text', 'transcript'))`
    ),
    check(
      "private_artifact_metadata",
      sql`length(trim(${table.ownerUserId})) > 0 AND length(trim(${table.workspaceId})) > 0
        AND length(trim(${table.sourceEventId})) BETWEEN 1 AND 256
        AND length(trim(${table.sourceMessageId})) BETWEEN 1 AND 256
        AND length(trim(${table.sourceMediaId})) BETWEEN 1 AND 256
        AND length(trim(${table.filename})) BETWEEN 1 AND 256
        AND length(trim(${table.mediaType})) BETWEEN 1 AND 128`
    ),
  ]
);
