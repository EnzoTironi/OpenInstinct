DROP INDEX "channel_outbox_dispatch_idx";--> statement-breakpoint
ALTER TABLE "channel_outbox" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_outbox_dispatch_idx" ON "channel_outbox" USING btree ("identity_id","status","sequence");