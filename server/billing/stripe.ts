import { Redacted } from "effect";
import { Stripe } from "stripe";
import { env } from "@shared/environment";

export class StripeNotConfiguredError extends Error {
  readonly _tag = "StripeNotConfiguredError";
  constructor() {
    super(
      "Paid billing is disabled. It requires ZOEN_BILLING_MODE=paid and configured Stripe credentials."
    );
  }
}

function requirePaidConfiguration<T>(value: T | undefined) {
  if (env.ZOEN_BILLING_MODE !== "paid" || !value)
    throw new StripeNotConfiguredError();
  return value;
}

export function requireStripe(): Stripe {
  const key = requirePaidConfiguration(env.STRIPE_SECRET_KEY);
  return new Stripe(Redacted.value(key), {
    apiVersion: "2025-08-27.basil",
    typescript: true,
  });
}

export function stripePriceIdForPlan(plan: "pro" | "org") {
  return requirePaidConfiguration(
    plan === "pro" ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_ORG_SEAT
  );
}

export function stripeWebhookSecret() {
  return Redacted.value(requirePaidConfiguration(env.STRIPE_WEBHOOK_SECRET));
}

/** True when Checkout can run for a paid plan (secret + that plan's Price id). */
export function isStripeCheckoutConfigured(plan: "pro" | "org"): boolean {
  if (env.ZOEN_BILLING_MODE !== "paid" || !env.STRIPE_SECRET_KEY) return false;
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
  return env.ZOEN_BILLING_MODE === "paid" && Boolean(env.STRIPE_SECRET_KEY);
}
