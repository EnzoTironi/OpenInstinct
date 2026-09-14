ALTER TABLE "channel_inbox" DROP CONSTRAINT "channel_inbox_native_input_check";--> statement-breakpoint
-- Never replay a pending group input into a private Eve conversation. Retain its
-- original receipt for audit; a new group message will start the isolated route.
UPDATE "channel_inbox" SET status = 'failed', last_error = 'adapter_rejected',
  lease_token = NULL, lease_expires_at = NULL
WHERE status NOT IN ('accepted', 'failed')
  AND payload->>'conversationScope' LIKE 'group:%'
  AND native_input->>'address' = identity_id::text;--> statement-breakpoint
ALTER TABLE "channel_inbox" ADD CONSTRAINT "channel_inbox_native_input_check" CHECK ("channel_inbox"."native_input" IS NULL OR COALESCE(
        jsonb_typeof("channel_inbox"."native_input") = 'object'
        AND "channel_inbox"."native_input"->>'protocol' = 'eve-keyed-input-v1'
        AND "channel_inbox"."native_input"->>'inputId' = "channel_inbox"."id"::text
        AND (
          "channel_inbox"."native_input"->>'address' = COALESCE("channel_inbox"."payload"->>'conversationScope', "channel_inbox"."identity_id"::text)
          OR ("channel_inbox"."status" IN ('accepted', 'failed') AND "channel_inbox"."native_input"->>'address' = "channel_inbox"."identity_id"::text)
        ), false));
