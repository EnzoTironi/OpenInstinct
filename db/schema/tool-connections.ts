import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaceMemberships, workspaces } from "./workspaces";
import { organizationMemberships } from "./organizations";

export const toolConnections = pgTable(
  "tool_connections",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectedBy: text("connected_by").notNull(),
    organizationId: text("organization_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    endpoint: text("endpoint").notNull(),
    credentials: text("credentials"),
    requestHash: text("request_hash").notNull(),
    revision: uuid("revision").notNull().defaultRandom(),
    operations: jsonb("operations").notNull(),
    share: text("share").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "tool_connections_workspace_owner_fkey",
      columns: [t.workspaceId, t.connectedBy],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "tool_connections_company_owner_fkey",
      columns: [t.organizationId, t.connectedBy],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("tool_connections_workspace_idx").on(t.workspaceId),
    check("tool_connections_kind_check", sql`${t.kind} IN ('mcp', 'openapi')`),
    check(
      "tool_connections_share_check",
      sql`${t.share} IN ('owner', 'workspace')`
    ),
  ]
);

export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => toolConnections.id, { onDelete: "cascade" }),
    invocationKey: text("invocation_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tool_invocations_key_uidx").on(t.workspaceId, t.invocationKey),
    check(
      "tool_invocations_status_check",
      sql`${t.status} IN ('started', 'completed', 'uncertain')`
    ),
  ]
);
