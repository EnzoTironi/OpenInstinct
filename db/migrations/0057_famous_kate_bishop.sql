CREATE TABLE "workspace_learned_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"type_id" text NOT NULL,
	"memory" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_learned_item_memory_check" CHECK (length("workspace_learned_item"."memory") > 0 AND length("workspace_learned_item"."memory") <= 8000),
	CONSTRAINT "workspace_learned_item_type_check" CHECK (length(trim("workspace_learned_item"."type_id")) > 0 AND length("workspace_learned_item"."type_id") <= 128)
);
--> statement-breakpoint
ALTER TABLE "workspace_learned_item" ADD CONSTRAINT "workspace_learned_item_namespace_id_workspace_memory_namespace_namespace_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."workspace_memory_namespace"("namespace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_learned_item_namespace_idx" ON "workspace_learned_item" USING btree ("namespace_id","type_id");