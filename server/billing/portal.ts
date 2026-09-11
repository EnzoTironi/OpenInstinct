import { readEntitlement } from "@db/services/billing";
import { applicationOrigin } from "@shared/environment/origin";
import { Effect, Schema } from "effect";

import { requireStripe } from "./stripe";

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

function portalStripeFailed(message: string) {
  return new BillingPortalError({
    reason: "stripe_failed",
    message,
  });
}

function portalSubject(input: { userId: string; organizationId?: string }) {
  if (input.organizationId) {
    return {
      subjectType: "organization" as const,
      subjectId: input.organizationId,
    };
  }

  return { subjectType: "user" as const, subjectId: input.userId };
}

const readEntitlementEffect = Effect.fn("readEntitlementEffect")(function* (
  subjectType: "user" | "organization",
  subjectId: string,
  message: string
) {
  return yield* Effect.tryPromise({
    try: () => readEntitlement(subjectType, subjectId),
    catch: () => portalStripeFailed(message),
  });
});

const resolvePortalCustomerId = Effect.fn("resolvePortalCustomerId")(
  function* (input: { userId: string; organizationId?: string }) {
    const subject = portalSubject(input);

    const entitlement = yield* readEntitlementEffect(
      subject.subjectType,
      subject.subjectId,
      "Unable to load entitlement."
    );

    if (entitlement.stripeCustomerId) return entitlement.stripeCustomerId;

    if (!input.organizationId) return null;

    const userEntitlement = yield* readEntitlementEffect(
      "user",
      input.userId,
      "Unable to load user entitlement."
    );

    return userEntitlement.stripeCustomerId;
  }
);

export const createCustomerPortalSession = Effect.fn(
  "createCustomerPortalSession"
)(function* (input: { userId: string; organizationId?: string }) {
  const stripe = yield* requireStripe().pipe(
    Effect.mapError(
      (error) =>
        new BillingPortalError({
          reason: "stripe_not_configured",
          message: error.message,
        })
    )
  );

  const customerId = yield* resolvePortalCustomerId(input);

  if (!customerId) {
    return yield* new BillingPortalError({
      reason: "no_customer",
      message: "No Stripe customer yet. Upgrade from /pricing first.",
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
      portalStripeFailed("Unable to create Customer Portal session."),
  });

  return { url: session.url };
});
