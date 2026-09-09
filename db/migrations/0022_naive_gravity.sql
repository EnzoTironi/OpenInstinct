ALTER TABLE "channel_auth_challenge" DROP CONSTRAINT "channel_auth_challenge_hash_check";--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ALTER COLUMN "browser_secret_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD COLUMN "intended_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD COLUMN "entry_token_hash" text;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD COLUMN "browser_bound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD COLUMN "source_session_id" text;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD COLUMN "source_call_id" text;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_intended_identity_fkey" FOREIGN KEY ("intended_identity_id","channel","installation_id") REFERENCES "public"."channel_identity"("id","channel","installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_auth_challenge_entry_uidx" ON "channel_auth_challenge" USING btree ("entry_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_auth_challenge_native_source_uidx" ON "channel_auth_challenge" USING btree ("intended_identity_id","source_session_id","source_call_id");--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_native_check" CHECK ((
        "channel_auth_challenge"."intended_identity_id" IS NULL
        AND "channel_auth_challenge"."entry_token_hash" IS NULL AND "channel_auth_challenge"."browser_bound_at" IS NULL
        AND "channel_auth_challenge"."source_session_id" IS NULL AND "channel_auth_challenge"."source_call_id" IS NULL
        AND "channel_auth_challenge"."browser_secret_hash" IS NOT NULL
      ) OR (
        "channel_auth_challenge"."intended_identity_id" IS NOT NULL AND "channel_auth_challenge"."purpose" = 'login'
        AND "channel_auth_challenge"."source_session_id" IS NOT NULL AND length(trim("channel_auth_challenge"."source_session_id")) > 0
        AND "channel_auth_challenge"."source_call_id" IS NOT NULL AND length(trim("channel_auth_challenge"."source_call_id")) > 0
        AND (
          ("channel_auth_challenge"."browser_bound_at" IS NULL AND "channel_auth_challenge"."browser_secret_hash" IS NULL
            AND "channel_auth_challenge"."entry_token_hash" IS NOT NULL AND "channel_auth_challenge"."confirmed_at" IS NULL)
          OR ("channel_auth_challenge"."browser_bound_at" IS NOT NULL AND "channel_auth_challenge"."browser_secret_hash" IS NOT NULL
            AND "channel_auth_challenge"."entry_token_hash" IS NULL AND "channel_auth_challenge"."browser_bound_at" >= "channel_auth_challenge"."created_at"
            AND "channel_auth_challenge"."browser_bound_at" < "channel_auth_challenge"."expires_at")
        )
        AND ("channel_auth_challenge"."confirmed_at" IS NULL OR "channel_auth_challenge"."confirmed_at" >= "channel_auth_challenge"."browser_bound_at")
        AND ("channel_auth_challenge"."identity_id" IS NULL OR "channel_auth_challenge"."identity_id" = "channel_auth_challenge"."intended_identity_id")
      ));--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_hash_check" CHECK ("channel_auth_challenge"."token_hash" ~ '^[0-9a-f]{64}$' AND ("channel_auth_challenge"."browser_secret_hash" IS NULL OR "channel_auth_challenge"."browser_secret_hash" ~ '^[0-9a-f]{64}$') AND ("channel_auth_challenge"."entry_token_hash" IS NULL OR "channel_auth_challenge"."entry_token_hash" ~ '^[0-9a-f]{64}$'));