CREATE TABLE "billing_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"seat_count" integer DEFAULT 1 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"current_period_end" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_entitlements_subject_type_check" CHECK ("billing_entitlements"."subject_type" IN ('user', 'organization')),
	CONSTRAINT "billing_entitlements_plan_check" CHECK ("billing_entitlements"."plan" IN ('free', 'pro', 'org')),
	CONSTRAINT "billing_entitlements_status_check" CHECK ("billing_entitlements"."status" IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
	CONSTRAINT "billing_entitlements_seat_count_check" CHECK ("billing_entitlements"."seat_count" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_entitlements_subject_uidx" ON "billing_entitlements" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_entitlements_stripe_customer_uidx" ON "billing_entitlements" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_entitlements_stripe_subscription_uidx" ON "billing_entitlements" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_entitlements_plan_idx" ON "billing_entitlements" USING btree ("plan");
