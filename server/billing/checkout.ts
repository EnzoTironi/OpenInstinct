import { Effect, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import {
  findEntitlementByStripeCustomer,
  readEntitlement,
  upsertEntitlement,
} from "@db/services/billing";
import { db, organizationMemberships } from "@db";
import { applicationOrigin } from "@shared/environment/origin";
import { isPaidPlan, type BillingPlanId } from "@shared/billing/plans";
import {
  requireStripe,
  stripePriceIdForPlan,
  StripeNotConfiguredError,
} from "./stripe";

export class BillingCheckoutError extends Schema.TaggedError<BillingCheckoutError>()(
  "BillingCheckoutError",
  {
    reason: Schema.Literals([
      "unauthenticated",
      "invalid_plan",
      "stripe_not_configured",
      "org_required",
      "org_forbidden",
      "stripe_failed",
    ]),
    message: Schema.String,
  }
) {}

async function assertOrgAdmin(organizationId: string, userId: string) {
  const rows = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId)
      )
    )
    .limit(1);
  return rows[0]?.role === "admin";
}

export const createCheckoutSession = Effect.fn("createCheckoutSession")(
  function* (input: {
    userId: string;
    email?: string | null;
    plan: BillingPlanId;
    organizationId?: string;
    seatCount?: number;
  }) {
    if (!isPaidPlan(input.plan)) {
      return yield* new BillingCheckoutError({
        reason: "invalid_plan",
        message: "Free does not require Checkout.",
      });
    }

    let stripe;
    let priceId: string;
    try {
      stripe = requireStripe();
      priceId = stripePriceIdForPlan(input.plan);
    } catch (error) {
      if (error instanceof StripeNotConfiguredError) {
        return yield* new BillingCheckoutError({
          reason: "stripe_not_configured",
          message: error.message,
        });
      }
      throw error;
    }

    const seatCount =
      input.plan === "org" ? Math.max(1, Math.floor(input.seatCount ?? 1)) : 1;

    const organizationId = input.organizationId;
    if (input.plan === "org") {
      if (!organizationId) {
        return yield* new BillingCheckoutError({
          reason: "org_required",
          message: "Org Checkout requires an organizationId.",
        });
      }
      const allowed = yield* Effect.tryPromise({
        try: () => assertOrgAdmin(organizationId, input.userId),
        catch: () =>
          new BillingCheckoutError({
            reason: "org_forbidden",
            message: "Unable to verify organization admin.",
          }),
      });
      if (!allowed) {
        return yield* new BillingCheckoutError({
          reason: "org_forbidden",
          message: "Only organization admins can purchase Org seats.",
        });
      }
    }

    const subjectType = input.plan === "org" ? "organization" : "user";
    const subjectId =
      input.plan === "org" && organizationId ? organizationId : input.userId;

    const entitlement = yield* Effect.tryPromise({
      try: () => readEntitlement(subjectType, subjectId),
      catch: () =>
        new BillingCheckoutError({
          reason: "stripe_failed",
          message: "Unable to load current entitlement.",
        }),
    });

    let customerId = entitlement.stripeCustomerId;
    if (!customerId) {
      const existingUser = yield* Effect.tryPromise({
        try: () => readEntitlement("user", input.userId),
        catch: () =>
          new BillingCheckoutError({
            reason: "stripe_failed",
            message: "Unable to load user billing customer.",
          }),
      });
      customerId = existingUser.stripeCustomerId;
    }

    if (customerId) {
      const existingCustomerId = customerId;
      const bound = yield* Effect.tryPromise({
        try: () => findEntitlementByStripeCustomer(existingCustomerId),
        catch: () => null,
      });
      if (
        bound &&
        (bound.subjectType !== subjectType || bound.subjectId !== subjectId)
      ) {
        customerId = null;
      }
    }

    if (!customerId) {
      const customer = yield* Effect.tryPromise({
        try: () =>
          stripe.customers.create({
            email: input.email ?? undefined,
            metadata: {
              instinctSubjectType: subjectType,
              instinctSubjectId: subjectId,
              instinctUserId: input.userId,
            },
          }),
        catch: () =>
          new BillingCheckoutError({
            reason: "stripe_failed",
            message: "Unable to create Stripe customer.",
          }),
      });
      customerId = customer.id;
      yield* Effect.tryPromise({
        try: () =>
          upsertEntitlement({
            subjectType,
            subjectId,
            plan: entitlement.plan,
            status: entitlement.status,
            seatCount: entitlement.seatCount,
            stripeCustomerId: customerId,
          }),
        catch: () =>
          new BillingCheckoutError({
            reason: "stripe_failed",
            message: "Unable to persist Stripe customer id.",
          }),
      });
    }

    if (!customerId) {
      return yield* new BillingCheckoutError({
        reason: "stripe_failed",
        message: "Stripe customer id missing after create.",
      });
    }

    const stripeCustomerId = customerId;
    const origin = applicationOrigin();
    const session = yield* Effect.tryPromise({
      try: () =>
        stripe.checkout.sessions.create({
          mode: "subscription",
          customer: stripeCustomerId,
          client_reference_id: subjectId,
          line_items: [{ price: priceId, quantity: seatCount }],
          success_url: `${origin}/account?billing=success`,
          cancel_url: `${origin}/pricing?billing=canceled`,
          metadata: {
            instinctPlan: input.plan,
            instinctSubjectType: subjectType,
            instinctSubjectId: subjectId,
            instinctUserId: input.userId,
            instinctSeatCount: String(seatCount),
          },
          subscription_data: {
            metadata: {
              instinctPlan: input.plan,
              instinctSubjectType: subjectType,
              instinctSubjectId: subjectId,
              instinctUserId: input.userId,
              instinctSeatCount: String(seatCount),
            },
          },
          allow_promotion_codes: true,
        }),
      catch: () =>
        new BillingCheckoutError({
          reason: "stripe_failed",
          message: "Unable to create Stripe Checkout session.",
        }),
    });

    if (!session.url) {
      return yield* new BillingCheckoutError({
        reason: "stripe_failed",
        message: "Stripe Checkout session missing redirect URL.",
      });
    }

    return { url: session.url };
  }
);
