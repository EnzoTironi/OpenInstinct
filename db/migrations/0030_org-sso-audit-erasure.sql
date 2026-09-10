CREATE TABLE "organization_audit_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text,
	"target_email" text,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"status" text NOT NULL,
	"accepted_user_id" text,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_audit_receipts" ADD CONSTRAINT "organization_audit_receipts_action_check" CHECK ("organization_audit_receipts"."action" IN ('invite_created', 'invite_accepted', 'invite_revoked', 'member_role_changed', 'member_removed', 'org_erasure_requested', 'org_erasure_denied')) NOT VALID;--> statement-breakpoint
ALTER TABLE "organization_audit_receipts" VALIDATE CONSTRAINT "organization_audit_receipts_action_check";--> statement-breakpoint
ALTER TABLE "organization_audit_receipts" ADD CONSTRAINT "organization_audit_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "organization_audit_receipts" VALIDATE CONSTRAINT "organization_audit_receipts_organization_id_fkey";--> statement-breakpoint
CREATE INDEX "organization_audit_receipts_org_created_idx" ON "organization_audit_receipts" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_role_check" CHECK ("organization_invites"."role" IN ('admin', 'member')) NOT VALID;--> statement-breakpoint
ALTER TABLE "organization_invites" VALIDATE CONSTRAINT "organization_invites_role_check";--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_status_check" CHECK ("organization_invites"."status" IN ('pending', 'accepted', 'revoked', 'expired')) NOT VALID;--> statement-breakpoint
ALTER TABLE "organization_invites" VALIDATE CONSTRAINT "organization_invites_status_check";--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "organization_invites" VALIDATE CONSTRAINT "organization_invites_organization_id_fkey";--> statement-breakpoint
CREATE INDEX "organization_invites_org_email_idx" ON "organization_invites" USING btree ("organization_id","email");
