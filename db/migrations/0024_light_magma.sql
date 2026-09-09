CREATE TABLE "private_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_identity_id" uuid NOT NULL,
	"source_inbox_id" uuid NOT NULL,
	"source_event_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"source_media_id" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea",
	"derived_text" text,
	"derived_kind" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "private_artifact_source_unique" UNIQUE("source_identity_id","source_event_id","source_media_id"),
	CONSTRAINT "private_artifact_length" CHECK ("private_artifact"."byte_length" BETWEEN 1 AND 10485760),
	CONSTRAINT "private_artifact_hash" CHECK ("private_artifact"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "private_artifact_content" CHECK (("private_artifact"."deleted_at" IS NULL AND "private_artifact"."content" IS NOT NULL AND octet_length("private_artifact"."content") = "private_artifact"."byte_length")
        OR ("private_artifact"."deleted_at" IS NOT NULL AND "private_artifact"."content" IS NULL AND "private_artifact"."derived_text" IS NULL AND "private_artifact"."derived_kind" IS NULL)),
	CONSTRAINT "private_artifact_derived" CHECK (("private_artifact"."derived_text" IS NULL AND "private_artifact"."derived_kind" IS NULL)
        OR ("private_artifact"."derived_text" IS NOT NULL AND octet_length("private_artifact"."derived_text") <= 65536 AND "private_artifact"."derived_kind" IS NOT NULL AND "private_artifact"."derived_kind" IN ('text', 'transcript'))),
	CONSTRAINT "private_artifact_metadata" CHECK (length(trim("private_artifact"."owner_user_id")) > 0 AND length(trim("private_artifact"."workspace_id")) > 0
        AND length(trim("private_artifact"."source_event_id")) BETWEEN 1 AND 256
        AND length(trim("private_artifact"."source_message_id")) BETWEEN 1 AND 256
        AND length(trim("private_artifact"."source_media_id")) BETWEEN 1 AND 256
        AND length(trim("private_artifact"."filename")) BETWEEN 1 AND 256
        AND length(trim("private_artifact"."media_type")) BETWEEN 1 AND 128)
);
--> statement-breakpoint
ALTER TABLE "private_artifact" ADD CONSTRAINT "private_artifact_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_artifact" ADD CONSTRAINT "private_artifact_source_identity_id_channel_identity_id_fk" FOREIGN KEY ("source_identity_id") REFERENCES "public"."channel_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_artifact" ADD CONSTRAINT "private_artifact_source_inbox_id_channel_inbox_id_fk" FOREIGN KEY ("source_inbox_id") REFERENCES "public"."channel_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_artifact_owner_created_idx" ON "private_artifact" USING btree ("workspace_id","owner_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "private_artifact"."deleted_at" IS NULL;