ALTER TABLE "channel_outbox" ADD COLUMN "effect_kind" text;--> statement-breakpoint
ALTER TABLE "channel_outbox" ADD COLUMN "operation_id" text;--> statement-breakpoint
UPDATE "channel_outbox" SET "effect_kind" = 'channel_send', "operation_id" = "delivery_key" WHERE "effect_kind" IS NULL OR "operation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "channel_outbox" ALTER COLUMN "effect_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_outbox" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_outbox_operation_idx" ON "channel_outbox" USING btree ("identity_id","operation_id");--> statement-breakpoint
ALTER TABLE "channel_outbox" ADD CONSTRAINT "channel_outbox_effect_kind_check" CHECK ("channel_outbox"."effect_kind" IN ('channel_send', 'mail', 'whatsapp'));--> statement-breakpoint
ALTER TABLE "channel_outbox" ADD CONSTRAINT "channel_outbox_operation_check" CHECK (length(trim("channel_outbox"."operation_id")) > 0 AND length("channel_outbox"."operation_id") <= 256);
