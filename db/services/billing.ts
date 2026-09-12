import { and, eq, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { billingEntitlements, db } from "@db";
import {
  type BillingPlanId,
  quotaLimitsForPlan,
  type PlanQuotaLimits,
} from "@shared/billing/plans";

export type BillingSubjectType = "user" | "organization";
export type BillingEntitlementStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface ResolvedEntitlement {
  plan: BillingPlanId;
  status: BillingEntitlementStatus;
  seatCount: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  limits: PlanQuotaLimits;
}

const freeEntitlement = (): ResolvedEntitlement => ({
  plan: "free",
  status: "active",
  seatCount: 1,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  limits: quotaLimitsForPlan("free"),
});

function isBillingPlanId(value: string): value is BillingPlanId {
  return value === "free" || value === "pro" || value === "org";
}

function toResolved(
  row: typeof billingEntitlements.$inferSelect
): ResolvedEntitlement {
  const plan: BillingPlanId = isBillingPlanId(row.plan) ? row.plan : "free";
  const paidActive =
    plan === "free" ||
    row.status === "active" ||
    row.status === "trialing" ||
    row.status === "past_due";
  const effectivePlan: BillingPlanId = paidActive ? plan : "free";
  return {
    plan: effectivePlan,
    status: row.status,
    seatCount: row.seatCount,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    limits: quotaLimitsForPlan(effectivePlan, row.seatCount),
  };
}

export async function readEntitlement(
  subjectType: BillingSubjectType,
  subjectId: string
): Promise<ResolvedEntitlement> {
  try {
    const rows = await db
      .select()
      .from(billingEntitlements)
      .where(
        and(
          eq(billingEntitlements.subjectType, subjectType),
          eq(billingEntitlements.subjectId, subjectId)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? toResolved(row) : freeEntitlement();
  } catch {
    // Missing table or a transient query failure must not take down Account.
    return freeEntitlement();
  }
}

export async function upsertEntitlement(input: {
  subjectType: BillingSubjectType;
  subjectId: string;
  plan: BillingPlanId;
  status: BillingEntitlementStatus;
  seatCount?: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  currentPeriodEnd?: Date | null;
}) {
  const now = new Date();
  const existing = await db
    .select({ id: billingEntitlements.id })
    .from(billingEntitlements)
    .where(
      and(
        eq(billingEntitlements.subjectType, input.subjectType),
        eq(billingEntitlements.subjectId, input.subjectId)
      )
    )
    .limit(1);

  const seatCount = Math.max(1, input.seatCount ?? 1);
  if (existing[0]) {
    await db
      .update(billingEntitlements)
      .set({
        plan: input.plan,
        status: input.status,
        seatCount,
        stripeCustomerId:
          input.stripeCustomerId === undefined
            ? undefined
            : input.stripeCustomerId,
        stripeSubscriptionId:
          input.stripeSubscriptionId === undefined
            ? undefined
            : input.stripeSubscriptionId,
        stripePriceId:
          input.stripePriceId === undefined ? undefined : input.stripePriceId,
        currentPeriodEnd:
          input.currentPeriodEnd === undefined
            ? undefined
            : input.currentPeriodEnd,
        updatedAt: now,
      })
      .where(eq(billingEntitlements.id, existing[0].id));
    return existing[0].id;
  }

  const id = randomUUID();
  await db.insert(billingEntitlements).values({
    id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    plan: input.plan,
    status: input.status,
    seatCount,
    stripeCustomerId: input.stripeCustomerId ?? null,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    stripePriceId: input.stripePriceId ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function findEntitlementByStripeCustomer(customerId: string) {
  const rows = await db
    .select()
    .from(billingEntitlements)
    .where(
      and(
        eq(billingEntitlements.stripeCustomerId, customerId),
        isNotNull(billingEntitlements.stripeCustomerId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findEntitlementByStripeSubscription(
  subscriptionId: string
) {
  const rows = await db
    .select()
    .from(billingEntitlements)
    .where(
      and(
        eq(billingEntitlements.stripeSubscriptionId, subscriptionId),
        isNotNull(billingEntitlements.stripeSubscriptionId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
