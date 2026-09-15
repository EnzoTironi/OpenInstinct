CREATE TABLE "personal_trust_blocks" (
	"user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_trust_blocks_user_id_blocked_user_id_pk" PRIMARY KEY("user_id","blocked_user_id"),
	CONSTRAINT "personal_trust_blocks_pair_check" CHECK ("personal_trust_blocks"."user_id" <> "personal_trust_blocks"."blocked_user_id")
);
--> statement-breakpoint
CREATE TABLE "personal_trust_edges" (
	"user_id" text NOT NULL,
	"peer_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_trust_edges_user_id_peer_user_id_pk" PRIMARY KEY("user_id","peer_user_id"),
	CONSTRAINT "personal_trust_edges_pair_check" CHECK ("personal_trust_edges"."user_id" <> "personal_trust_edges"."peer_user_id")
);
--> statement-breakpoint
CREATE TABLE "personal_trust_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_trust_invites_status_check" CHECK ("personal_trust_invites"."status" IN ('pending', 'accepted', 'revoked', 'declined')),
	CONSTRAINT "personal_trust_invites_pair_check" CHECK ("personal_trust_invites"."from_user_id" <> "personal_trust_invites"."to_user_id")
);
--> statement-breakpoint
ALTER TABLE "agent_protocol_tasks" ADD COLUMN "correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_protocol_tasks" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_protocol_tasks" ADD COLUMN "origin_task_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD COLUMN "requester_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD COLUMN "network_kind" text;--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD COLUMN "network_id" text;--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD COLUMN "origin_bot_id" uuid;--> statement-breakpoint
CREATE INDEX "personal_trust_edges_peer_idx" ON "personal_trust_edges" USING btree ("peer_user_id");--> statement-breakpoint
CREATE INDEX "personal_trust_invites_recipient_idx" ON "personal_trust_invites" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_trust_invites_pending_uidx" ON "personal_trust_invites" USING btree ("from_user_id","to_user_id") WHERE "personal_trust_invites"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "agent_protocol_tasks" ADD CONSTRAINT "agent_protocol_tasks_origin_task_id_agent_protocol_tasks_id_fk" FOREIGN KEY ("origin_task_id") REFERENCES "public"."agent_protocol_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD CONSTRAINT "workspace_agent_grants_origin_bot_id_workspace_bots_id_fk" FOREIGN KEY ("origin_bot_id") REFERENCES "public"."workspace_bots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_protocol_tasks_correlation_idx" ON "agent_protocol_tasks" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "workspace_agent_grants_requester_idx" ON "workspace_agent_grants" USING btree ("requester_user_id");--> statement-breakpoint
ALTER TABLE "agent_protocol_tasks" ADD CONSTRAINT "agent_protocol_tasks_round_check" CHECK ("agent_protocol_tasks"."round" BETWEEN 1 AND 8);--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD CONSTRAINT "workspace_agent_grants_network_check" CHECK (("workspace_agent_grants"."requester_user_id" IS NULL) = ("workspace_agent_grants"."network_kind" IS NULL)
        AND ("workspace_agent_grants"."requester_user_id" IS NULL) = ("workspace_agent_grants"."network_id" IS NULL)
        AND ("workspace_agent_grants"."network_kind" IS NULL OR "workspace_agent_grants"."network_kind" IN ('company', 'personal'))
        AND ("workspace_agent_grants"."origin_bot_id" IS NULL OR "workspace_agent_grants"."requester_user_id" IS NOT NULL));