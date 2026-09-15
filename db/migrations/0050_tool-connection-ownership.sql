ALTER TABLE "tool_connections" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "tool_connections" AS c SET "organization_id" = w."organization_id" FROM "workspaces" AS w WHERE w."id" = c."workspace_id";--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_workspace_owner_fkey" FOREIGN KEY ("workspace_id","connected_by") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_company_owner_fkey" FOREIGN KEY ("organization_id","connected_by") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;
