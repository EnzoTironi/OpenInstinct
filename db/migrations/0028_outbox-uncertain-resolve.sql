CREATE TABLE "channel_outbox_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"detail" text NOT NULL,
	"prior_status" text NOT NULL,
	"prior_error" text,
	"actor_principal_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_outbox_resolution_decision_check" CHECK ("channel_outbox_resolution"."decision" IN ('mark_delivered', 'cancel', 'authorize_retry')),
	CONSTRAINT "channel_outbox_resolution_prior_status_check" CHECK ("channel_outbox_resolution"."prior_status" = 'uncertain'),
	CONSTRAINT "channel_outbox_resolution_detail_check" CHECK (length(trim("channel_outbox_resolution"."detail")) > 0 AND length("channel_outbox_resolution"."detail") <= 512),
	CONSTRAINT "channel_outbox_resolution_actor_check" CHECK (length(trim("channel_outbox_resolution"."actor_principal_id")) > 0 AND length("channel_outbox_resolution"."actor_principal_id") <= 256),
	CONSTRAINT "channel_outbox_resolution_note_check" CHECK ("channel_outbox_resolution"."note" IS NULL OR (length(trim("channel_outbox_resolution"."note")) > 0 AND length("channel_outbox_resolution"."note") <= 200)),
	CONSTRAINT "channel_outbox_resolution_prior_error_check" CHECK ("channel_outbox_resolution"."prior_error" IS NULL OR length("channel_outbox_resolution"."prior_error") <= 200)
);
--> statement-breakpoint
ALTER TABLE "channel_outbox_resolution" ADD CONSTRAINT "channel_outbox_resolution_outbox_id_channel_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."channel_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_outbox_resolution" ADD CONSTRAINT "channel_outbox_resolution_identity_id_channel_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."channel_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_outbox_resolution_outbox_idx" ON "channel_outbox_resolution" USING btree ("outbox_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_outbox_resolution_identity_idx" ON "channel_outbox_resolution" USING btree ("identity_id","created_at");