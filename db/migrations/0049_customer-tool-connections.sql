CREATE TABLE "tool_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connected_by" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"endpoint" text NOT NULL,
	"credentials" text,
	"request_hash" text NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"operations" jsonb NOT NULL,
	"share" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_connections_kind_check" CHECK ("tool_connections"."kind" IN ('mcp', 'openapi')),
	CONSTRAINT "tool_connections_share_check" CHECK ("tool_connections"."share" IN ('owner', 'workspace'))
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"invocation_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tool_invocations_status_check" CHECK ("tool_invocations"."status" IN ('started', 'completed', 'uncertain'))
);
--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_connections_workspace_idx" ON "tool_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_invocations_key_uidx" ON "tool_invocations" USING btree ("workspace_id","invocation_key");