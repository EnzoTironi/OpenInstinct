CREATE TABLE "account_deletion_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "account_deletion_ledger_status_check" CHECK ("account_deletion_ledger"."status" IN ('erased', 'retained_company', 'pending_external', 'backup_held'))
);
--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"blocked_reason" text,
	"backup_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "account_deletion_requests_status_check" CHECK ("account_deletion_requests"."status" IN ('blocked', 'pending_external', 'completed')),
	CONSTRAINT "account_deletion_requests_blocked_check" CHECK (("account_deletion_requests"."status" = 'blocked' AND "account_deletion_requests"."blocked_reason" = 'sole_owner' AND "account_deletion_requests"."completed_at" IS NULL)
        OR ("account_deletion_requests"."status" IN ('pending_external', 'completed') AND "account_deletion_requests"."blocked_reason" IS NULL AND "account_deletion_requests"."completed_at" IS NOT NULL AND "account_deletion_requests"."backup_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "account_deletion_tombstones" (
	"user_id" text PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion_ledger" ADD CONSTRAINT "account_deletion_ledger_request_id_account_deletion_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."account_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_tombstones" ADD CONSTRAINT "account_deletion_tombstones_request_id_account_deletion_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."account_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_ledger_surface_uidx" ON "account_deletion_ledger" USING btree ("request_id","surface");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_user_uidx" ON "account_deletion_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_deletion_tombstones_deleted_idx" ON "account_deletion_tombstones" USING btree ("deleted_at");