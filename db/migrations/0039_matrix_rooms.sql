CREATE TABLE "matrix_deliveries" (
	"event_id" text PRIMARY KEY NOT NULL,
	"binding_id" uuid NOT NULL,
	"epoch" uuid NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"prompt" text,
	"session_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_deliveries_state_check" CHECK ("matrix_deliveries"."state" IN ('pending', 'dispatched', 'answer_ready', 'completed', 'suppressed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "matrix_identities" (
	"user_id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	CONSTRAINT "matrix_identities_matrix_id_unique" UNIQUE("matrix_id")
);
--> statement-breakpoint
CREATE TABLE "matrix_received_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matrix_room_members" (
	"binding_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_room_members_binding_id_user_id_pk" PRIMARY KEY("binding_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "matrix_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_group_bindings" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matrix_deliveries" ADD CONSTRAINT "matrix_deliveries_binding_id_workspace_group_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."workspace_group_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_room_members" ADD CONSTRAINT "matrix_room_members_binding_id_workspace_group_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."workspace_group_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_room_members" ADD CONSTRAINT "matrix_room_members_user_id_matrix_identities_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."matrix_identities"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matrix_deliveries_pending_idx" ON "matrix_deliveries" USING btree ("state","created_at");