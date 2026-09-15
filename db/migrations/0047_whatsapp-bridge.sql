CREATE TABLE "whatsapp_bridge_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pairing_nonce_hash" text NOT NULL,
	"remote_user_id" text,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_bridge_accounts_status_check" CHECK (("whatsapp_bridge_accounts"."status" = 'pairing' AND "whatsapp_bridge_accounts"."remote_user_id" IS NULL AND "whatsapp_bridge_accounts"."revoked_at" IS NULL)
        OR ("whatsapp_bridge_accounts"."status" IN ('connected', 'paused') AND "whatsapp_bridge_accounts"."remote_user_id" IS NOT NULL AND "whatsapp_bridge_accounts"."revoked_at" IS NULL)
        OR ("whatsapp_bridge_accounts"."status" = 'revoked' AND "whatsapp_bridge_accounts"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_bridge_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"remote_chat_id" text NOT NULL,
	"kind" text NOT NULL,
	"last_backfill_at" timestamp with time zone,
	"last_live_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_bridge_chats_kind_check" CHECK ("whatsapp_bridge_chats"."kind" IN ('dm', 'group'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_bridge_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"remote_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_bridge_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"body" text NOT NULL,
	"authorized_body" text,
	"authorized_chat_id" uuid,
	"status" text NOT NULL,
	"issued_by" text NOT NULL,
	"queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_bridge_drafts_status_check" CHECK ("whatsapp_bridge_drafts"."status" IN ('draft', 'authorized', 'queued', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_bridge_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"author_remote_id" text NOT NULL,
	"body" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_bridge_events_kind_check" CHECK ("whatsapp_bridge_events"."kind" IN ('backfill', 'live'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_bridge_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"issued_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_accounts" ADD CONSTRAINT "whatsapp_bridge_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_chats" ADD CONSTRAINT "whatsapp_bridge_chats_account_id_whatsapp_bridge_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."whatsapp_bridge_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_contacts" ADD CONSTRAINT "whatsapp_bridge_contacts_account_id_whatsapp_bridge_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."whatsapp_bridge_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_drafts" ADD CONSTRAINT "whatsapp_bridge_drafts_account_id_whatsapp_bridge_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."whatsapp_bridge_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_drafts" ADD CONSTRAINT "whatsapp_bridge_drafts_chat_id_whatsapp_bridge_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."whatsapp_bridge_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_drafts" ADD CONSTRAINT "whatsapp_bridge_drafts_authorized_chat_id_fkey" FOREIGN KEY ("authorized_chat_id") REFERENCES "public"."whatsapp_bridge_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_events" ADD CONSTRAINT "whatsapp_bridge_events_account_id_whatsapp_bridge_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."whatsapp_bridge_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_events" ADD CONSTRAINT "whatsapp_bridge_events_chat_id_whatsapp_bridge_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."whatsapp_bridge_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_shares" ADD CONSTRAINT "whatsapp_bridge_shares_chat_id_whatsapp_bridge_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."whatsapp_bridge_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_shares" ADD CONSTRAINT "whatsapp_bridge_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_bridge_accounts_workspace_uidx" ON "whatsapp_bridge_accounts" USING btree ("workspace_id") WHERE "whatsapp_bridge_accounts"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_bridge_accounts_remote_uidx" ON "whatsapp_bridge_accounts" USING btree ("remote_user_id") WHERE "whatsapp_bridge_accounts"."remote_user_id" IS NOT NULL AND "whatsapp_bridge_accounts"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_bridge_chats_live_uidx" ON "whatsapp_bridge_chats" USING btree ("account_id","remote_chat_id") WHERE "whatsapp_bridge_chats"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_bridge_chats_account_idx" ON "whatsapp_bridge_chats" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_bridge_contacts_remote_uidx" ON "whatsapp_bridge_contacts" USING btree ("account_id","remote_user_id");--> statement-breakpoint
CREATE INDEX "whatsapp_bridge_drafts_account_idx" ON "whatsapp_bridge_drafts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_bridge_events_provider_uidx" ON "whatsapp_bridge_events" USING btree ("account_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "whatsapp_bridge_events_chat_idx" ON "whatsapp_bridge_events" USING btree ("chat_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_bridge_shares_live_uidx" ON "whatsapp_bridge_shares" USING btree ("chat_id","workspace_id") WHERE "whatsapp_bridge_shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_bridge_shares_workspace_idx" ON "whatsapp_bridge_shares" USING btree ("workspace_id");