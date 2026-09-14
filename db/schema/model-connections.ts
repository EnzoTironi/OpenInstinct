import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { session } from "./auth";

export const modelConnections = pgTable(
  "model_connections",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    credentials: text("credentials"),
    revision: uuid("revision").defaultRandom().notNull(),
    connectedBy: text("connected_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "model_connections_provider_check",
      sql`${t.provider} IN ('chatgpt', 'grok')`
    ),
  ]
);

export const modelOauthRequests = pgTable(
  "model_oauth_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    authSessionId: text("auth_session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    payload: text("payload").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("model_oauth_requests_workspace_idx").on(t.workspaceId),
    check(
      "model_oauth_requests_provider_check",
      sql`${t.provider} IN ('chatgpt', 'grok')`
    ),
  ]
);
