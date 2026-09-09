CREATE TABLE "personal_memory_binding" (
	"key" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"namespace" text NOT NULL,
	"slot" text NOT NULL,
	CONSTRAINT "personal_memory_binding_workspace_namespace_slot_unique" UNIQUE("workspace_id","namespace","slot"),
	CONSTRAINT "personal_memory_binding_key_check" CHECK (length("personal_memory_binding"."key") BETWEEN 1 AND 512 AND trim("personal_memory_binding"."key") = "personal_memory_binding"."key"),
	CONSTRAINT "personal_memory_binding_namespace_check" CHECK (octet_length("personal_memory_binding"."namespace") BETWEEN 1 AND 1024),
	CONSTRAINT "personal_memory_binding_slot_check" CHECK ("personal_memory_binding"."slot" = 'profile')
);
--> statement-breakpoint
ALTER TABLE "personal_memory_binding" ADD CONSTRAINT "personal_memory_binding_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;