import { db, organizationMemberships } from "@db";
import {
  findEntitlementByStripeCustomer,
  readEntitlement,
  upsertEntitlement,
} from "@db/services/billing";
import { isPaidPlan, type BillingPlanId } from "@shared/billing/plans";
import { applicationOrigin } from "@shared/environment/origin";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { Stripe } from "stripe";

import { requireStripe, stripePriceIdForPlan } from "./stripe";

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

const billingFail = (reason: BillingCheckoutError["reason"], message: string) =>
  new BillingCheckoutError({ reason, message });

const requireOrgCheckoutAdmin = Effect.fn("Billing.requireOrgCheckoutAdmin")(
  function* (organizationId: string | undefined, userId: string) {
    if (!organizationId) {
      return yield* billingFail(
        "org_required",
        "Org Checkout requires an organizationId."
      );
    }

    const allowed = yield* loadOrgAdmin(organizationId, userId);

    if (!allowed) {
      return yield* billingFail(
        "org_forbidden",
        "Only organization admins can purchase Org seats."
      );
    }

    return yield* Effect.void;
  }
);

function loadOrgAdmin(organizationId: string, userId: string) {
  return Effect.tryPromise({
    try: () => assertOrgAdmin(organizationId, userId),
    catch: () =>
      billingFail("org_forbidden", "Unable to verify organization admin."),
  });
}

function loadEntitlement(
  subjectType: "organization" | "user",
  subjectId: string
) {
  return Effect.tryPromise({
    try: () => readEntitlement(subjectType, subjectId),
    catch: () =>
      billingFail("stripe_failed", "Unable to load current entitlement."),
  });
}

function loadUserBillingCustomer(userId: string) {
  return Effect.tryPromise({
    try: () => readEntitlement("user", userId),
    catch: () =>
      billingFail("stripe_failed", "Unable to load user billing customer."),
  });
}

function lookupCustomerBinding(customerId: string) {
  return Effect.tryPromise({
    try: () => findEntitlementByStripeCustomer(customerId),
    catch: () => null,
  });
}

function createStripeCustomer(options: {
  readonly stripe: Stripe;
  readonly email?: string | null;
  readonly subjectType: "organization" | "user";
  readonly subjectId: string;
  readonly userId: string;
}) {
  return Effect.tryPromise({
    try: () =>
      options.stripe.customers.create({
        email: options.email ?? undefined,
        metadata: {
          instinctSubjectType: options.subjectType,
          instinctSubjectId: options.subjectId,
          instinctUserId: options.userId,
        },
      }),
    catch: () =>
      billingFail("stripe_failed", "Unable to create Stripe customer."),
  });
}

function persistStripeCustomerId(options: {
  readonly subjectType: "organization" | "user";
  readonly subjectId: string;
  readonly entitlement: Awaited<ReturnType<typeof readEntitlement>>;
  readonly stripeCustomerId: string;
}) {
  return Effect.tryPromise({
    try: () =>
      upsertEntitlement({
        subjectType: options.subjectType,
        subjectId: options.subjectId,
        plan: options.entitlement.plan,
        status: options.entitlement.status,
        seatCount: options.entitlement.seatCount,
        stripeCustomerId: options.stripeCustomerId,
      }),
    catch: () =>
      billingFail("stripe_failed", "Unable to persist Stripe customer id."),
  });
}

function createCheckoutSessionRemote(options: {
  readonly stripe: Stripe;
  readonly priceId: string;
  readonly seatCount: number;
  readonly stripeCustomerId: string;
  readonly subjectId: string;
  readonly subjectType: "organization" | "user";
  readonly userId: string;
  readonly plan: BillingPlanId;
}) {
  const origin = applicationOrigin();

  const metadata = {
    instinctPlan: options.plan,
    instinctSubjectType: options.subjectType,
    instinctSubjectId: options.subjectId,
    instinctUserId: options.userId,
    instinctSeatCount: String(options.seatCount),
  };

  return Effect.tryPromise({
    try: () =>
      options.stripe.checkout.sessions.create({
        mode: "subscription",
        customer: options.stripeCustomerId,
        client_reference_id: options.subjectId,
        line_items: [{ price: options.priceId, quantity: options.seatCount }],
        success_url: `${origin}/account?billing=success`,
        cancel_url: `${origin}/pricing?billing=canceled`,
        metadata,
        subscription_data: { metadata },
        allow_promotion_codes: true,
      }),
    catch: () =>
      billingFail("stripe_failed", "Unable to create Stripe Checkout session."),
  });
}

function customerBelongsToSubject(
  bound: Awaited<ReturnType<typeof findEntitlementByStripeCustomer>> | null,
  subjectType: "organization" | "user",
  subjectId: string
) {
  if (!bound) return true;

  return bound.subjectType === subjectType && bound.subjectId === subjectId;
}

const reuseOrClearCustomerId = Effect.fn("Billing.reuseOrClearCustomerId")(
  function* (
    customerId: string | null,
    subjectType: "organization" | "user",
    subjectId: string
  ) {
    if (!customerId) return null;

    const bound = yield* lookupCustomerBinding(customerId);

    if (customerBelongsToSubject(bound, subjectType, subjectId)) {
      return customerId;
    }

    return null;
  }
);

const mintCheckoutCustomer = Effect.fn("Billing.mintCheckoutCustomer")(
  function* (options: {
    readonly stripe: Stripe;
    readonly subjectType: "organization" | "user";
    readonly subjectId: string;
    readonly userId: string;
    readonly email?: string | null;
    readonly entitlement: Awaited<ReturnType<typeof readEntitlement>>;
  }) {
    const customer = yield* createStripeCustomer({
      stripe: options.stripe,
      email: options.email,
      subjectType: options.subjectType,
      subjectId: options.subjectId,
      userId: options.userId,
    });

    yield* persistStripeCustomerId({
      subjectType: options.subjectType,
      subjectId: options.subjectId,
      entitlement: options.entitlement,
      stripeCustomerId: customer.id,
    });

    return customer.id;
  }
);

const resolveCheckoutCustomerId = Effect.fn(
  "Billing.resolveCheckoutCustomerId"
)(function* (options: {
  readonly stripe: Stripe;
  readonly subjectType: "organization" | "user";
  readonly subjectId: string;
  readonly userId: string;
  readonly email?: string | null;
  readonly entitlement: Awaited<ReturnType<typeof readEntitlement>>;
}) {
  let customerId = options.entitlement.stripeCustomerId;

  if (!customerId) {
    const existingUser = yield* loadUserBillingCustomer(options.userId);
    customerId = existingUser.stripeCustomerId;
  }

  customerId = yield* reuseOrClearCustomerId(
    customerId,
    options.subjectType,
    options.subjectId
  );

  if (customerId) return customerId;

  return yield* mintCheckoutCustomer(options);
});

function checkoutSeatCount(plan: BillingPlanId, seatCount?: number) {
  if (plan !== "org") return 1;

  return Math.max(1, Math.floor(seatCount ?? 1));
}

interface CheckoutSubject {
  readonly subjectType: "organization" | "user";
  readonly subjectId: string;
}

function checkoutSubject(
  plan: BillingPlanId,
  userId: string,
  organizationId?: string
): CheckoutSubject {
  if (plan === "org" && organizationId) {
    return { subjectType: "organization", subjectId: organizationId };
  }

  return { subjectType: "user", subjectId: userId };
}

const mapStripeConfigError = (error: { readonly message: string }) =>
  billingFail("stripe_not_configured", error.message);

export const createCheckoutSession = Effect.fn("createCheckoutSession")(
  function* (input: {
    userId: string;
    email?: string | null;
    plan: BillingPlanId;
    organizationId?: string;
    seatCount?: number;
  }) {
    if (!isPaidPlan(input.plan)) {
      return yield* billingFail(
        "invalid_plan",
        "Free does not require Checkout."
      );
    }

    const stripe = yield* requireStripe().pipe(
      Effect.mapError(mapStripeConfigError)
    );

    const priceId = yield* stripePriceIdForPlan(input.plan).pipe(
      Effect.mapError(mapStripeConfigError)
    );

    if (input.plan === "org") {
      yield* requireOrgCheckoutAdmin(input.organizationId, input.userId);
    }

    const { subjectType, subjectId } = checkoutSubject(
      input.plan,
      input.userId,
      input.organizationId
    );

    const entitlement = yield* loadEntitlement(subjectType, subjectId);

    const stripeCustomerId = yield* resolveCheckoutCustomerId({
      stripe,
      subjectType,
      subjectId,
      userId: input.userId,
      email: input.email,
      entitlement,
    });

    const session = yield* createCheckoutSessionRemote({
      stripe,
      priceId,
      seatCount: checkoutSeatCount(input.plan, input.seatCount),
      stripeCustomerId,
      subjectId,
      subjectType,
      userId: input.userId,
      plan: input.plan,
    });

    if (!session.url) {
      return yield* billingFail(
        "stripe_failed",
        "Stripe Checkout session missing redirect URL."
      );
    }

    return { url: session.url };
  }
);
