import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";
import type { Schema } from "effect";
import { workspaces } from "./workspaces";

export const telemetrySettings = pgTable("telemetry_settings", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  captureContent: boolean("capture_content").notNull().default(true),
  retentionDays: integer("retention_days").notNull().default(14),
});

export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id"),
    sessionId: text("session_id"),
    turnId: text("turn_id"),
    kind: text("kind").notNull(),
    channel: text("channel"),
    model: text("model"),
    name: text("name"),
    status: text("status"),
    durationMs: doublePrecision("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: doublePrecision("cost_usd"),
    metadata: jsonb("metadata").$type<Schema.Json>().notNull(),
    payload: text("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("telemetry_events_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt
    ),
    index("telemetry_events_session_idx").on(t.sessionId, t.createdAt),
    index("telemetry_events_created_idx").on(t.createdAt),
  ]
);

export const telemetryReviews = pgTable("telemetry_reviews", {
  sessionId: text("session_id").primaryKey(),
  status: text("status").notNull(),
  reviewedBy: text("reviewed_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
