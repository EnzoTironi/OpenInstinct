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
