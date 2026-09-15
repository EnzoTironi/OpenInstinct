import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaceAgentGrants, agentProtocolTasks } from "./workspace-agents";
import { workspaces } from "./workspaces";

export const matrixAgentConversations = pgTable(
  "matrix_agent_conversations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requesterId: text("requester_id").notNull(),
    grantId: uuid("grant_id")
      .notNull()
      .unique()
      .references(() => workspaceAgentGrants.id, { onDelete: "cascade" }),
    roomId: text("room_id").notNull().unique(),
    serverName: text("server_name").notNull(),
    senderId: text("sender_id").notNull(),
    botId: text("bot_id").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("matrix_agent_conversations_requester_idx").on(
      t.workspaceId,
      t.requesterId
    ),
  ]
);

export const matrixAgentMessages = pgTable("matrix_agent_messages", {
  eventId: text("event_id").primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => matrixAgentConversations.id, { onDelete: "cascade" }),
  taskId: uuid("task_id")
    .notNull()
    .unique()
    .references(() => agentProtocolTasks.id, { onDelete: "cascade" }),
  answerEventId: text("answer_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const matrixAgentSends = pgTable(
  "matrix_agent_sends",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => matrixAgentConversations.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    eventId: text("event_id"),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.operationId] })]
);

/** Retire external memberships even when the originating grant has been deleted. */
export const matrixRoomRetirements = pgTable("matrix_room_retirements", {
  roomId: text("room_id").primaryKey(),
  serverName: text("server_name").notNull(),
  senderId: text("sender_id").notNull(),
  botId: text("bot_id").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
