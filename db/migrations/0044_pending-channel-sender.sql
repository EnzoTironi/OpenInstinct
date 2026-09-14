CREATE TABLE "channel_pending_sender" (
	"channel" text NOT NULL,
	"installation_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_count" integer DEFAULT 1 NOT NULL,
	"prompted_at" timestamp with time zone,
	CONSTRAINT "channel_pending_sender_pkey" PRIMARY KEY("channel","installation_id","sender_id"),
	CONSTRAINT "channel_pending_sender_channel_check" CHECK ("channel_pending_sender"."channel" IN ('telegram', 'kapso')),
	CONSTRAINT "channel_pending_sender_address_check" CHECK (length(trim("channel_pending_sender"."installation_id")) > 0 AND length(trim("channel_pending_sender"."sender_id")) > 0),
	CONSTRAINT "channel_pending_sender_count_check" CHECK ("channel_pending_sender"."contact_count" > 0),
	CONSTRAINT "channel_pending_sender_seen_check" CHECK ("channel_pending_sender"."last_seen_at" >= "channel_pending_sender"."first_seen_at" AND ("channel_pending_sender"."prompted_at" IS NULL OR "channel_pending_sender"."prompted_at" >= "channel_pending_sender"."first_seen_at"))
);
