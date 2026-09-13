-- Snapshot metadata now includes the already-applied migrations 0032–0036.
CREATE TABLE "workspace_agent_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"issued_by" text NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_bots_username_check" CHECK ("workspace_bots"."username" ~ '^[a-z][a-z0-9_]{2,29}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_connections" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"label" text NOT NULL,
	"credentials" text NOT NULL,
	"connected_by" text NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_connections_provider_check" CHECK ("workspace_connections"."provider" = 'google')
);
--> statement-breakpoint
CREATE TABLE "workspace_group_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel" text NOT NULL,
	"installation_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"label" text NOT NULL,
	"created_by" text NOT NULL,
	"epoch" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_group_bindings_channel_check" CHECK ("workspace_group_bindings"."channel" IN ('telegram', 'matrix'))
);
--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD CONSTRAINT "workspace_agent_grants_bot_id_workspace_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."workspace_bots"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_bots" ADD CONSTRAINT "workspace_bots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_connections" ADD CONSTRAINT "workspace_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_group_bindings" ADD CONSTRAINT "workspace_group_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_agent_grants_token_uidx" ON "workspace_agent_grants" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "workspace_agent_grants_bot_idx" ON "workspace_agent_grants" USING btree ("bot_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_bots_workspace_uidx" ON "workspace_bots" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_bots_username_uidx" ON "workspace_bots" USING btree ("username");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_group_bindings_conversation_uidx" ON "workspace_group_bindings" USING btree ("channel","installation_id","conversation_id");
