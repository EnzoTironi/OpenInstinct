ALTER TABLE "whatsapp_bridge_accounts" DROP CONSTRAINT "whatsapp_bridge_accounts_status_check";--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_accounts" ADD COLUMN "matrix_user_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_accounts" ADD COLUMN "login_id" text;--> statement-breakpoint
UPDATE "whatsapp_bridge_accounts" SET "matrix_user_id" = 'legacy-unbound' WHERE "status" IN ('connected', 'paused') AND "matrix_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_chats" ADD COLUMN "matrix_room_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_events" ADD COLUMN "matrix_event_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_bridge_chats_room_uidx" ON "whatsapp_bridge_chats" USING btree ("matrix_room_id") WHERE "whatsapp_bridge_chats"."matrix_room_id" IS NOT NULL AND "whatsapp_bridge_chats"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_bridge_accounts" ADD CONSTRAINT "whatsapp_bridge_accounts_status_check" CHECK (("whatsapp_bridge_accounts"."status" = 'pairing' AND "whatsapp_bridge_accounts"."remote_user_id" IS NULL AND "whatsapp_bridge_accounts"."revoked_at" IS NULL)
        OR ("whatsapp_bridge_accounts"."status" IN ('connected', 'paused') AND "whatsapp_bridge_accounts"."remote_user_id" IS NOT NULL AND "whatsapp_bridge_accounts"."matrix_user_id" IS NOT NULL AND "whatsapp_bridge_accounts"."revoked_at" IS NULL)
        OR ("whatsapp_bridge_accounts"."status" = 'revoked' AND "whatsapp_bridge_accounts"."revoked_at" IS NOT NULL));