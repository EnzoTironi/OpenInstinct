CREATE TABLE "channel_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sequence" bigserial NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"session_id" text,
	"accepted_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "channel_inbox_status_check" CHECK ("channel_inbox"."status" IN ('queued', 'dispatching', 'accepted', 'uncertain', 'failed')),
	CONSTRAINT "channel_inbox_payload_check" CHECK (jsonb_typeof("channel_inbox"."payload") = 'object' AND length(trim("channel_inbox"."event_id")) > 0 AND "channel_inbox"."event_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "channel_inbox_attempts_check" CHECK ("channel_inbox"."attempts" >= 0),
	CONSTRAINT "channel_inbox_lease_check" CHECK ("channel_inbox"."status" <> 'dispatching' OR ("channel_inbox"."lease_token" IS NOT NULL AND "channel_inbox"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "channel_inbox_accepted_check" CHECK ("channel_inbox"."status" <> 'accepted' OR ("channel_inbox"."session_id" IS NOT NULL AND "channel_inbox"."accepted_at" IS NOT NULL)),
	CONSTRAINT "channel_inbox_error_check" CHECK ("channel_inbox"."last_error" IS NULL OR length("channel_inbox"."last_error") <= 200)
);
--> statement-breakpoint
CREATE TABLE "channel_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"delivery_key" text NOT NULL,
	"intent_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "channel_outbox_status_check" CHECK ("channel_outbox"."status" IN ('queued', 'dispatching', 'sent', 'uncertain', 'failed', 'cancelled')),
	CONSTRAINT "channel_outbox_payload_check" CHECK (jsonb_typeof("channel_outbox"."payload") = 'object' AND length(trim("channel_outbox"."delivery_key")) > 0 AND "channel_outbox"."intent_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "channel_outbox_attempts_check" CHECK ("channel_outbox"."attempts" >= 0),
	CONSTRAINT "channel_outbox_lease_check" CHECK ("channel_outbox"."status" <> 'dispatching' OR ("channel_outbox"."lease_token" IS NOT NULL AND "channel_outbox"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "channel_outbox_sent_check" CHECK ("channel_outbox"."status" <> 'sent' OR ("channel_outbox"."provider_message_id" IS NOT NULL AND "channel_outbox"."sent_at" IS NOT NULL)),
	CONSTRAINT "channel_outbox_error_check" CHECK ("channel_outbox"."last_error" IS NULL OR length("channel_outbox"."last_error") <= 200)
);
--> statement-breakpoint
ALTER TABLE "channel_inbox" ADD CONSTRAINT "channel_inbox_identity_id_channel_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."channel_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_outbox" ADD CONSTRAINT "channel_outbox_identity_id_channel_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."channel_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_inbox_event_uidx" ON "channel_inbox" USING btree ("identity_id","event_id");--> statement-breakpoint
CREATE INDEX "channel_inbox_dispatch_idx" ON "channel_inbox" USING btree ("identity_id","status","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_outbox_delivery_uidx" ON "channel_outbox" USING btree ("identity_id","delivery_key");--> statement-breakpoint
CREATE INDEX "channel_outbox_dispatch_idx" ON "channel_outbox" USING btree ("identity_id","status","created_at");