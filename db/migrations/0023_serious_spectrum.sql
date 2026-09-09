ALTER TABLE "channel_auth_challenge" DROP CONSTRAINT "channel_auth_challenge_purpose_check";--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" DROP CONSTRAINT "channel_auth_challenge_native_check";--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_purpose_check" CHECK (("channel_auth_challenge"."purpose" = 'login' AND "channel_auth_challenge"."target_user_id" IS NULL AND "channel_auth_challenge"."requesting_session_id" IS NULL) OR (
        "channel_auth_challenge"."purpose" = 'link' AND (
          ("channel_auth_challenge"."intended_identity_id" IS NOT NULL AND "channel_auth_challenge"."browser_bound_at" IS NULL
            AND "channel_auth_challenge"."target_user_id" IS NULL AND "channel_auth_challenge"."requesting_session_id" IS NULL)
          OR (("channel_auth_challenge"."intended_identity_id" IS NULL OR "channel_auth_challenge"."browser_bound_at" IS NOT NULL)
            AND "channel_auth_challenge"."target_user_id" IS NOT NULL AND "channel_auth_challenge"."requesting_session_id" IS NOT NULL)
        )
      ));--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_native_check" CHECK ((
        "channel_auth_challenge"."intended_identity_id" IS NULL
        AND "channel_auth_challenge"."entry_token_hash" IS NULL AND "channel_auth_challenge"."browser_bound_at" IS NULL
        AND "channel_auth_challenge"."source_session_id" IS NULL AND "channel_auth_challenge"."source_call_id" IS NULL
        AND "channel_auth_challenge"."browser_secret_hash" IS NOT NULL
      ) OR (
        "channel_auth_challenge"."intended_identity_id" IS NOT NULL AND "channel_auth_challenge"."purpose" IN ('login', 'link')
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
      ));