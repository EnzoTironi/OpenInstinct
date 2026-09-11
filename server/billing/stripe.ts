import { env } from "@shared/environment";
import { Effect, Redacted, Schema } from "effect";
import { Stripe } from "stripe";

export class StripeNotConfiguredError extends Schema.TaggedError<StripeNotConfiguredError>()(
  "StripeNotConfiguredError",
  {
    message: Schema.String,
  }
) {}

const notConfigured = () =>
  new StripeNotConfiguredError({
    message:
      "Stripe is not configured. Set STRIPE_SECRET_KEY and plan price IDs to enable paid upgrades.",
  });

export const requireStripe = Effect.fn("requireStripe")(function* () {
  const key = env.STRIPE_SECRET_KEY;

  if (!key) {
    return yield* notConfigured();
  }

  return new Stripe(Redacted.value(key), {
    apiVersion: "2025-08-27.basil",
    typescript: true,
  });
});

export const stripePriceIdForPlan = Effect.fn("stripePriceIdForPlan")(
  function* (plan: "pro" | "org") {
    const priceId =
      plan === "pro" ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_ORG_SEAT;

    if (!priceId) {
      return yield* notConfigured();
    }

    return priceId;
  }
);

export const stripeWebhookSecret = Effect.fn("stripeWebhookSecret")(
  function* () {
    const secret = env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      return yield* notConfigured();
    }

    return Redacted.value(secret);
  }
);

/** True when Checkout can run for a paid plan (secret + that plan's Price id). */
export function isStripeCheckoutConfigured(plan: "pro" | "org"): boolean {
  if (!env.STRIPE_SECRET_KEY) return false;

  return plan === "pro"
    ? Boolean(env.STRIPE_PRICE_PRO)
    : Boolean(env.STRIPE_PRICE_ORG_SEAT);
}

/** True when any paid Checkout CTA may be offered (secret + at least one Price). */
export function isStripeBillingConfigured(): boolean {
  return isStripeCheckoutConfigured("pro") || isStripeCheckoutConfigured("org");
}

/** Customer Portal needs the Stripe secret; CTAs should stay off without it. */
export function isStripePortalConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}
