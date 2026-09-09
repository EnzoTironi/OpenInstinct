CREATE TABLE "channel_input_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"inbox_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"request_id" text NOT NULL,
	"revision" text NOT NULL,
	"decision" text NOT NULL,
	"turn_id" text NOT NULL,
	"status" text DEFAULT 'attempted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "channel_input_response_status_check" CHECK ("channel_input_response"."status" IN ('attempted', 'accepted', 'uncertain')),
	CONSTRAINT "channel_input_response_decision_check" CHECK ("channel_input_response"."decision" IN ('approve', 'cancel')),
	CONSTRAINT "channel_input_response_revision_check" CHECK ("channel_input_response"."revision" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "channel_input_response_completion_check" CHECK (("channel_input_response"."status" = 'attempted') = ("channel_input_response"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "channel_input_response" ADD CONSTRAINT "channel_input_response_identity_id_channel_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."channel_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_input_response" ADD CONSTRAINT "channel_input_response_inbox_id_channel_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."channel_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_input_response_request_uidx" ON "channel_input_response" USING btree ("session_id","request_id");