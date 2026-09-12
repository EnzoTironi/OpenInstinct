import { Effect, Schema } from "effect";
import { readEntitlement } from "@db/services/billing";
import { applicationOrigin } from "@shared/environment/origin";
import { requireStripe, StripeNotConfiguredError } from "./stripe";

export class BillingPortalError extends Schema.TaggedError<BillingPortalError>()(
  "BillingPortalError",
  {
    reason: Schema.Literals([
      "unauthenticated",
      "stripe_not_configured",
      "no_customer",
      "stripe_failed",
    ]),
    message: Schema.String,
  }
) {}

export const createCustomerPortalSession = Effect.fn(
  "createCustomerPortalSession"
)(function* (input: { userId: string; organizationId?: string }) {
  let stripe;
  try {
    stripe = requireStripe();
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      return yield* new BillingPortalError({
        reason: "stripe_not_configured",
        message: error.message,
      });
    }
    throw error;
  }

  const subjectType = input.organizationId ? "organization" : "user";
  const subjectId = input.organizationId ?? input.userId;
  const entitlement = yield* Effect.tryPromise({
    try: () => readEntitlement(subjectType, subjectId),
    catch: () =>
      new BillingPortalError({
        reason: "stripe_failed",
        message: "Unable to load entitlement.",
      }),
  });

  let customerId = entitlement.stripeCustomerId;
  if (!customerId && input.organizationId) {
    const userEntitlement = yield* Effect.tryPromise({
      try: () => readEntitlement("user", input.userId),
      catch: () =>
        new BillingPortalError({
          reason: "stripe_failed",
          message: "Unable to load user entitlement.",
        }),
    });
    customerId = userEntitlement.stripeCustomerId;
  }

  if (!customerId) {
    return yield* new BillingPortalError({
      reason: "no_customer",
      message: "Billing management is available after your first subscription.",
    });
  }

  const origin = applicationOrigin();
  const session = yield* Effect.tryPromise({
    try: () =>
      stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/account`,
      }),
    catch: () =>
      new BillingPortalError({
        reason: "stripe_failed",
        message: "Unable to create Customer Portal session.",
      }),
  });

  return { url: session.url };
});
