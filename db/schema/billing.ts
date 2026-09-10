import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Hosted plan entitlements (C-BILL). Missing row ⇒ Free.
 * Stripe customer / subscription IDs are opaque references only.
 */
export const billingEntitlements = pgTable(
  "billing_entitlements",
  {
    id: text("id").primaryKey(),
    subjectType: text("subject_type", {
      enum: ["user", "organization"],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    plan: text("plan", { enum: ["free", "pro", "org"] }).notNull(),
    status: text("status", {
      enum: ["active", "trialing", "past_due", "canceled", "incomplete"],
    }).notNull(),
    seatCount: integer("seat_count").notNull().default(1),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),
    currentPeriodEnd: timestamp("current_period_end", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("billing_entitlements_subject_uidx").on(
      table.subjectType,
      table.subjectId
    ),
    uniqueIndex("billing_entitlements_stripe_customer_uidx").on(
      table.stripeCustomerId
    ),
    uniqueIndex("billing_entitlements_stripe_subscription_uidx").on(
      table.stripeSubscriptionId
    ),
    check(
      "billing_entitlements_subject_type_check",
      sql`${table.subjectType} IN ('user', 'organization')`
    ),
    check(
      "billing_entitlements_plan_check",
      sql`${table.plan} IN ('free', 'pro', 'org')`
    ),
    check(
      "billing_entitlements_status_check",
      sql`${table.status} IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')`
    ),
    check(
      "billing_entitlements_seat_count_check",
      sql`${table.seatCount} >= 1`
    ),
    index("billing_entitlements_plan_idx").on(table.plan),
  ]
);

export const billingEntitlementsRelations = relations(
  billingEntitlements,
  () => ({})
);
