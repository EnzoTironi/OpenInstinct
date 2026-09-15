CREATE TABLE "vault_agent_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"wrapping_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vault_item_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"wrapped_secret" text NOT NULL,
	"issued_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_agent_identities" ADD CONSTRAINT "vault_agent_identities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item_delegations" ADD CONSTRAINT "vault_item_delegations_identity_id_vault_agent_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."vault_agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item_delegations" ADD CONSTRAINT "vault_item_delegations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item_delegations" ADD CONSTRAINT "vault_item_delegations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_agent_identities_workspace_uidx" ON "vault_agent_identities" USING btree ("workspace_id") WHERE "vault_agent_identities"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_item_delegations_live_uidx" ON "vault_item_delegations" USING btree ("identity_id","item_id") WHERE "vault_item_delegations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "vault_item_delegations_workspace_idx" ON "vault_item_delegations" USING btree ("workspace_id");