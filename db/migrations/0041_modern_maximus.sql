CREATE TABLE "model_connections" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"credentials" text,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connected_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_connections_provider_check" CHECK ("model_connections"."provider" IN ('chatgpt', 'grok'))
);
--> statement-breakpoint
CREATE TABLE "model_oauth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"auth_session_id" text NOT NULL,
	"provider" text NOT NULL,
	"payload" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_oauth_requests_provider_check" CHECK ("model_oauth_requests"."provider" IN ('chatgpt', 'grok'))
);
--> statement-breakpoint
ALTER TABLE "model_connections" ADD CONSTRAINT "model_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_oauth_requests" ADD CONSTRAINT "model_oauth_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_oauth_requests" ADD CONSTRAINT "model_oauth_requests_auth_session_id_session_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_oauth_requests_workspace_idx" ON "model_oauth_requests" USING btree ("workspace_id");