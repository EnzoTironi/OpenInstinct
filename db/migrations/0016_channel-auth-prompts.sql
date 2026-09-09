ALTER TABLE "channel_auth_challenge" ADD CONSTRAINT "channel_auth_challenge_installation_key" UNIQUE("id","channel","installation_id");--> statement-breakpoint
CREATE TABLE "channel_auth_prompt" (
	"challenge_id" uuid PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"installation_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"event_id" text NOT NULL,
	"token_ciphertext" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_auth_prompt_status_check" CHECK ("channel_auth_prompt"."status" IN ('queued', 'dispatching', 'sent', 'uncertain', 'failed', 'cancelled')),
	CONSTRAINT "channel_auth_prompt_attempts_check" CHECK ("channel_auth_prompt"."attempts" >= 0),
	CONSTRAINT "channel_auth_prompt_address_check" CHECK (length(trim("channel_auth_prompt"."sender_id")) > 0 AND length(trim("channel_auth_prompt"."event_id")) > 0),
	CONSTRAINT "channel_auth_prompt_ciphertext_check" CHECK (("channel_auth_prompt"."status" IN ('queued', 'dispatching') AND "channel_auth_prompt"."token_ciphertext" IS NOT NULL AND length("channel_auth_prompt"."token_ciphertext") BETWEEN 1 AND 8192) OR ("channel_auth_prompt"."status" IN ('sent', 'uncertain', 'failed', 'cancelled') AND "channel_auth_prompt"."token_ciphertext" IS NULL)),
	CONSTRAINT "channel_auth_prompt_lease_check" CHECK (("channel_auth_prompt"."status" = 'dispatching' AND "channel_auth_prompt"."lease_token" IS NOT NULL AND "channel_auth_prompt"."lease_expires_at" IS NOT NULL) OR ("channel_auth_prompt"."status" <> 'dispatching' AND "channel_auth_prompt"."lease_token" IS NULL AND "channel_auth_prompt"."lease_expires_at" IS NULL)),
	CONSTRAINT "channel_auth_prompt_sent_check" CHECK ("channel_auth_prompt"."status" <> 'sent' OR ("channel_auth_prompt"."provider_message_id" IS NOT NULL AND "channel_auth_prompt"."sent_at" IS NOT NULL)),
	CONSTRAINT "channel_auth_prompt_error_check" CHECK ("channel_auth_prompt"."last_error" IS NULL OR length("channel_auth_prompt"."last_error") <= 100)
);
--> statement-breakpoint
ALTER TABLE "channel_auth_prompt" ADD CONSTRAINT "channel_auth_prompt_challenge_fkey" FOREIGN KEY ("challenge_id","channel","installation_id") REFERENCES "public"."channel_auth_challenge"("id","channel","installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_auth_prompt_event_uidx" ON "channel_auth_prompt" USING btree ("channel","installation_id","event_id");--> statement-breakpoint
CREATE INDEX "channel_auth_prompt_dispatch_idx" ON "channel_auth_prompt" USING btree ("status","created_at");
