CREATE TABLE "account_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_user_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_archive_source_user_id_unique" UNIQUE("source_user_id"),
	CONSTRAINT "account_archive_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "account_archive_challenge_id_unique" UNIQUE("challenge_id"),
	CONSTRAINT "account_archive_distinct_users" CHECK ("account_archive"."source_user_id" <> "account_archive"."target_user_id")
);
--> statement-breakpoint
DROP INDEX "channel_identity_sender_uidx";--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD COLUMN "source_user_id" text;--> statement-breakpoint
ALTER TABLE "account_archive" ADD CONSTRAINT "account_archive_source_user_id_user_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_archive" ADD CONSTRAINT "account_archive_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_archive" ADD CONSTRAINT "account_archive_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_archive_target_idx" ON "account_archive" USING btree ("target_user_id");--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_source_user_id_user_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_identity_sender_uidx" ON "channel_identity" USING btree ("channel","installation_id","sender_id") WHERE "channel_identity"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_archive_check" CHECK ("channel_auth_challenge"."source_user_id" IS NULL OR ("channel_auth_challenge"."purpose" = 'link' AND "channel_auth_challenge"."intended_identity_id" IS NOT NULL AND "channel_auth_challenge"."browser_bound_at" IS NOT NULL AND "channel_auth_challenge"."source_user_id" <> "channel_auth_challenge"."target_user_id"));