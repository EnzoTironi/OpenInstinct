import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const workspaceConnections = pgTable(
  "workspace_connections",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google"),
    label: text("label").notNull(),
    credentials: text("credentials").notNull(),
    connectedBy: text("connected_by").notNull(),
    revision: uuid("revision").defaultRandom().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "workspace_connections_provider_check",
      sql`${table.provider} = 'google'`
    ),
  ]
);

export const workspaceBots = pgTable(
  "workspace_bots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    discoverable: boolean("discoverable").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_bots_workspace_uidx").on(table.workspaceId),
    uniqueIndex("workspace_bots_username_uidx").on(table.username),
    check(
      "workspace_bots_username_check",
      sql`${table.username} ~ '^[a-z][a-z0-9_]{2,29}$'`
    ),
  ]
);

export const workspaceAgentGrants = pgTable(
  "workspace_agent_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => workspaceBots.id, { onDelete: "cascade" }),
    issuedBy: text("issued_by").notNull(),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    capabilities: jsonb("capabilities").$type<readonly string[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    requesterUserId: text("requester_user_id"),
    networkKind: text("network_kind"),
    networkId: text("network_id"),
    originBotId: uuid("origin_bot_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_agent_grants_token_uidx").on(table.tokenHash),
    index("workspace_agent_grants_bot_idx").on(table.botId),
    index("workspace_agent_grants_requester_idx").on(table.requesterUserId),
    foreignKey({
      columns: [table.originBotId],
      foreignColumns: [workspaceBots.id],
    }).onDelete("set null"),
    check(
      "workspace_agent_grants_network_check",
      sql`(${table.requesterUserId} IS NULL) = (${table.networkKind} IS NULL)
        AND (${table.requesterUserId} IS NULL) = (${table.networkId} IS NULL)
        AND (${table.networkKind} IS NULL OR ${table.networkKind} IN ('company', 'personal'))
        AND (${table.originBotId} IS NULL OR ${table.requesterUserId} IS NOT NULL)`
    ),
  ]
);

export const workspaceGroupBindings = pgTable(
  "workspace_group_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    installationId: text("installation_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    label: text("label").notNull(),
    createdBy: text("created_by").notNull(),
    epoch: uuid("epoch").defaultRandom().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_group_bindings_conversation_uidx").on(
      table.channel,
      table.installationId,
      table.conversationId
    ),
    check(
      "workspace_group_bindings_channel_check",
      sql`${table.channel} IN ('telegram', 'matrix')`
    ),
  ]
);

export const agentProtocolTasks = pgTable(
  "agent_protocol_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => workspaceAgentGrants.id, { onDelete: "cascade" }),
    contextId: uuid("context_id").defaultRandom().notNull(),
    messageId: text("message_id").notNull(),
    requestHash: text("request_hash").notNull(),
    prompt: text("prompt").notNull(),
    sessionId: text("session_id"),
    state: text("state").notNull().default("TASK_STATE_SUBMITTED"),
    output: text("output"),
    correlationId: uuid("correlation_id").defaultRandom().notNull(),
    round: integer("round").notNull().default(1),
    originTaskId: uuid("origin_task_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_protocol_tasks_message_uidx").on(
      table.grantId,
      table.messageId
    ),
    index("agent_protocol_tasks_session_idx").on(table.sessionId),
    index("agent_protocol_tasks_correlation_idx").on(table.correlationId),
    foreignKey({
      columns: [table.originTaskId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    check(
      "agent_protocol_tasks_state_check",
      sql`${table.state} IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_INPUT_REQUIRED')`
    ),
    check(
      "agent_protocol_tasks_round_check",
      sql`${table.round} BETWEEN 1 AND 8`
    ),
  ]
);
