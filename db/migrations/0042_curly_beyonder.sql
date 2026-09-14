CREATE TABLE "telemetry_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"user_id" text,
	"session_id" text,
	"turn_id" text,
	"kind" text NOT NULL,
	"channel" text,
	"model" text,
	"name" text,
	"status" text,
	"duration_ms" double precision,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"metadata" jsonb NOT NULL,
	"payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_reviews" (
	"session_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"capture_content" boolean DEFAULT true NOT NULL,
	"retention_days" integer DEFAULT 14 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_settings" ADD CONSTRAINT "telemetry_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telemetry_events_workspace_created_idx" ON "telemetry_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_events_session_idx" ON "telemetry_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_events_created_idx" ON "telemetry_events" USING btree ("created_at");