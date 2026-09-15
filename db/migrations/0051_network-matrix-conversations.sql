CREATE TABLE "matrix_agent_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"server_name" text NOT NULL,
	"sender_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_agent_conversations_grant_id_unique" UNIQUE("grant_id"),
	CONSTRAINT "matrix_agent_conversations_room_id_unique" UNIQUE("room_id")
);
--> statement-breakpoint
CREATE TABLE "matrix_agent_messages" (
	"event_id" text PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"answer_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_agent_messages_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "matrix_agent_sends" (
	"conversation_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"event_id" text,
	CONSTRAINT "matrix_agent_sends_conversation_id_operation_id_pk" PRIMARY KEY("conversation_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD COLUMN "source_workspace_id" text;--> statement-breakpoint
ALTER TABLE "matrix_agent_conversations" ADD CONSTRAINT "matrix_agent_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_agent_conversations" ADD CONSTRAINT "matrix_agent_conversations_grant_id_workspace_agent_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."workspace_agent_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_agent_messages" ADD CONSTRAINT "matrix_agent_messages_conversation_id_matrix_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."matrix_agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_agent_messages" ADD CONSTRAINT "matrix_agent_messages_task_id_agent_protocol_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_protocol_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_agent_sends" ADD CONSTRAINT "matrix_agent_sends_conversation_id_matrix_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."matrix_agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matrix_agent_conversations_requester_idx" ON "matrix_agent_conversations" USING btree ("workspace_id","requester_id");--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD CONSTRAINT "workspace_agent_grants_source_member_fkey" FOREIGN KEY ("source_workspace_id","requester_user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Legacy network grants do not record their source project. Retire them instead
-- of guessing an audience; reopening a conversation creates a scoped grant.
UPDATE workspace_agent_grants SET revoked_at = now() WHERE requester_user_id IS NOT NULL AND source_workspace_id IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
UPDATE agent_protocol_tasks t SET state = 'TASK_STATE_CANCELED', output = NULL, updated_at = now() FROM workspace_agent_grants g WHERE g.id = t.grant_id AND g.requester_user_id IS NOT NULL AND g.source_workspace_id IS NULL AND t.state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED');
