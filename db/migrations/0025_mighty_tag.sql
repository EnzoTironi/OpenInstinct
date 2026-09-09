ALTER TABLE "channel_inbox" ADD COLUMN "native_input" jsonb;--> statement-breakpoint
ALTER TABLE "channel_inbox" ADD CONSTRAINT "channel_inbox_native_input_check" CHECK ("channel_inbox"."native_input" IS NULL OR COALESCE(
        jsonb_typeof("channel_inbox"."native_input") = 'object'
        AND "channel_inbox"."native_input"->>'protocol' = 'eve-keyed-input-v1'
        AND "channel_inbox"."native_input"->>'inputId' = "channel_inbox"."id"::text
        AND "channel_inbox"."native_input"->>'address' = "channel_inbox"."identity_id"::text, false));