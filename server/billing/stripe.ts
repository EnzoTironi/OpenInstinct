import { Redacted } from "effect";
import { Stripe } from "stripe";
import { env } from "@shared/environment";

export class StripeNotConfiguredError extends Error {
  readonly _tag = "StripeNotConfiguredError";
  constructor() {
    super(
      "Stripe is not configured. Set STRIPE_SECRET_KEY and plan price IDs to enable paid upgrades."
    );
  }
}

export function requireStripe(): Stripe {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  return new Stripe(Redacted.value(key), {
    apiVersion: "2025-08-27.basil",
    typescript: true,
  });
}

export function stripePriceIdForPlan(plan: "pro" | "org") {
  const priceId =
    plan === "pro" ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_ORG_SEAT;
  if (!priceId) throw new StripeNotConfiguredError();
  return priceId;
}

export function stripeWebhookSecret() {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeNotConfiguredError();
  return Redacted.value(secret);
}

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
