CREATE TABLE "agent_protocol_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"context_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"prompt" text NOT NULL,
	"session_id" text,
	"state" text DEFAULT 'TASK_STATE_SUBMITTED' NOT NULL,
	"output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_protocol_tasks_state_check" CHECK ("agent_protocol_tasks"."state" IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_INPUT_REQUIRED'))
);
--> statement-breakpoint
ALTER TABLE "agent_protocol_tasks" ADD CONSTRAINT "agent_protocol_tasks_grant_id_workspace_agent_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."workspace_agent_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_protocol_tasks_message_uidx" ON "agent_protocol_tasks" USING btree ("grant_id","message_id");--> statement-breakpoint
CREATE INDEX "agent_protocol_tasks_session_idx" ON "agent_protocol_tasks" USING btree ("session_id");