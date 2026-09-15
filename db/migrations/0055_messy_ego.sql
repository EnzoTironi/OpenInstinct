CREATE TABLE "operon_claim" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operon_claim_workspace_id_user_id_id_pk" PRIMARY KEY("workspace_id","user_id","id"),
	CONSTRAINT "operon_claim_kind_check" CHECK ("operon_claim"."kind" IN ('interpretation', 'provider_metadata')),
	CONSTRAINT "operon_claim_state_check" CHECK ("operon_claim"."state" IN ('accepted', 'proposed', 'separated', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "operon_contact_identity" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"handle" text NOT NULL,
	"person_id" text NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operon_contact_identity_workspace_id_user_id_id_pk" PRIMARY KEY("workspace_id","user_id","id"),
	CONSTRAINT "operon_contact_identity_handle_uidx" UNIQUE("workspace_id","user_id","handle")
);
--> statement-breakpoint
CREATE TABLE "operon_identity_merge" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"left_identity_id" text NOT NULL,
	"left_person_id" text NOT NULL,
	"right_identity_id" text NOT NULL,
	"right_person_id" text NOT NULL,
	"evidence_source_id" text NOT NULL,
	"status" text NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operon_identity_merge_workspace_id_user_id_id_pk" PRIMARY KEY("workspace_id","user_id","id"),
	CONSTRAINT "operon_identity_merge_status_check" CHECK ("operon_identity_merge"."status" IN ('accepted', 'proposed', 'separated'))
);
--> statement-breakpoint
CREATE TABLE "operon_object_revision" (
	"object_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"revision" text NOT NULL,
	"type_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"operational_status" text,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operon_object_revision_workspace_id_user_id_object_id_revision_pk" PRIMARY KEY("workspace_id","user_id","object_id","revision")
);
--> statement-breakpoint
CREATE TABLE "operon_object" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type_id" text NOT NULL,
	"revision" text NOT NULL,
	"body" jsonb NOT NULL,
	"operational_status" text,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operon_object_workspace_id_user_id_id_pk" PRIMARY KEY("workspace_id","user_id","id")
);
--> statement-breakpoint
CREATE TABLE "operon_source" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_revision" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operon_source_workspace_id_user_id_id_pk" PRIMARY KEY("workspace_id","user_id","id"),
	CONSTRAINT "operon_source_provider_uidx" UNIQUE("workspace_id","user_id","provider_id","provider_revision"),
	CONSTRAINT "operon_source_scope_check" CHECK (length(trim("operon_source"."user_id")) > 0 AND length(trim("operon_source"."workspace_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "operon_claim" ADD CONSTRAINT "operon_claim_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_claim" ADD CONSTRAINT "operon_claim_source_fkey" FOREIGN KEY ("workspace_id","user_id","source_id") REFERENCES "public"."operon_source"("workspace_id","user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_contact_identity" ADD CONSTRAINT "operon_contact_identity_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_identity_merge" ADD CONSTRAINT "operon_identity_merge_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_identity_merge" ADD CONSTRAINT "operon_identity_merge_evidence_fkey" FOREIGN KEY ("workspace_id","user_id","evidence_source_id") REFERENCES "public"."operon_source"("workspace_id","user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_object_revision" ADD CONSTRAINT "operon_object_revision_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_object_revision" ADD CONSTRAINT "operon_object_revision_object_fkey" FOREIGN KEY ("workspace_id","user_id","object_id") REFERENCES "public"."operon_object"("workspace_id","user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_object" ADD CONSTRAINT "operon_object_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operon_source" ADD CONSTRAINT "operon_source_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operon_claim_subject_idx" ON "operon_claim" USING btree ("workspace_id","user_id","subject_id");--> statement-breakpoint
CREATE INDEX "operon_contact_identity_person_idx" ON "operon_contact_identity" USING btree ("workspace_id","user_id","person_id");--> statement-breakpoint
CREATE INDEX "operon_object_type_idx" ON "operon_object" USING btree ("workspace_id","user_id","type_id");--> statement-breakpoint
CREATE INDEX "operon_source_scope_recorded_idx" ON "operon_source" USING btree ("workspace_id","user_id","recorded_at" DESC NULLS LAST);