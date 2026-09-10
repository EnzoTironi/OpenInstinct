CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_pkey" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "organization_id" text;--> statement-breakpoint
DO $$
DECLARE
	was_validated boolean;
BEGIN
	SELECT convalidated
	INTO was_validated
	FROM pg_constraint
	WHERE conrelid = 'public.workspace_memberships'::regclass
		AND conname = 'workspace_memberships_role_check';

	ALTER TABLE "workspace_memberships" DROP CONSTRAINT IF EXISTS "workspace_memberships_role_check";
	ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_role_check" CHECK ("workspace_memberships"."role" IN ('owner', 'admin', 'member')) NOT VALID;

	IF was_validated IS DISTINCT FROM false THEN
		ALTER TABLE "workspace_memberships" VALIDATE CONSTRAINT "workspace_memberships_role_check";
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_role_check" CHECK ("organization_memberships"."role" IN ('admin', 'member')) NOT VALID;--> statement-breakpoint
ALTER TABLE "organization_memberships" VALIDATE CONSTRAINT "organization_memberships_role_check";--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "organization_memberships" VALIDATE CONSTRAINT "organization_memberships_organization_id_fkey";--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "workspaces" VALIDATE CONSTRAINT "workspaces_organization_id_fkey";
