import {
  findEntitlementByStripeSubscription,
  upsertEntitlement,
  type BillingEntitlementStatus,
  type BillingSubjectType,
} from "@db/services/billing";
import type { BillingPlanId } from "@shared/billing/plans";
import { Effect, Option, Schema } from "effect";
import type { Stripe } from "stripe";

import { requireStripe, stripeWebhookSecret } from "./stripe";

export class BillingWebhookError extends Schema.TaggedError<BillingWebhookError>()(
  "BillingWebhookError",
  {
    reason: Schema.Literals([
      "stripe_not_configured",
      "invalid_signature",
      "unhandled",
    ]),
    message: Schema.String,
  }
) {}

function mapSubscriptionStatus(
  status: Stripe.Subscription.Status
): BillingEntitlementStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "canceled";
    default:
      return "incomplete";
  }
}

function parsePlan(raw: string | undefined): BillingPlanId | null {
  if (raw === "pro" || raw === "org" || raw === "free") return raw;

  return null;
}

function parseSubjectType(raw: string | undefined): BillingSubjectType | null {
  if (raw === "user" || raw === "organization") return raw;

  return null;
}

const stripeIdRefSchema = Schema.Union([
  Schema.String,
  Schema.Struct({ id: Schema.String }),
]);

const decodeOption_stripeIdRefSchema =
  Schema.decodeUnknownOption(stripeIdRefSchema);

function stripeIdFromRef(value: typeof stripeIdRefSchema.Type): string {
  if (Schema.is(Schema.String)(value)) return value;

  return value.id;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stripe SDK customer/subscription fields are string | expanded object at the webhook boundary.
function readStripeId(field: unknown): string | null {
  // Stripe expands customer/subscription into objects or leaves string ids.
  const decoded = decodeOption_stripeIdRefSchema(field);

  if (Option.isNone(decoded)) return null;

  return stripeIdFromRef(decoded.value);
}

async function applySubscription(subscription: Stripe.Subscription) {
  const metadata = subscription.metadata;
  const plan = parsePlan(metadata.instinctPlan);
  const subjectType = parseSubjectType(metadata.instinctSubjectType);
  const subjectId = metadata.instinctSubjectId;
  const quantity = subscription.items.data[0]?.quantity ?? 1;
  const seatFromMeta = Number(metadata.instinctSeatCount ?? quantity);

  const seatCount = Math.max(
    1,
    Number.isFinite(seatFromMeta) ? seatFromMeta : 1
  );

  let resolvedType = subjectType;
  let resolvedId = subjectId;

  if (!resolvedType || !resolvedId) {
    const existing = await findEntitlementByStripeSubscription(subscription.id);

    if (existing) {
      resolvedType = existing.subjectType;
      resolvedId = existing.subjectId;
    }
  }

  if (!resolvedType || !resolvedId) return;

  const effectivePlan: BillingPlanId =
    plan ?? (resolvedType === "organization" ? "org" : "pro");

  const status = mapSubscriptionStatus(subscription.status);
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const customerId = readStripeId(subscription.customer);
  const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
  const periodEnd = itemPeriodEnd ? new Date(itemPeriodEnd * 1000) : null;

  await upsertEntitlement({
    subjectType: resolvedType,
    subjectId: resolvedId,
    plan: status === "canceled" ? "free" : effectivePlan,
    status,
    seatCount,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodEnd: periodEnd,
  });
}

async function applyCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return;
  const metadata = session.metadata ?? {};
  const plan = parsePlan(metadata.instinctPlan);
  const subjectType = parseSubjectType(metadata.instinctSubjectType);
  const subjectId = metadata.instinctSubjectId;

  if (!plan || !subjectType || !subjectId) return;

  if (plan === "free") return;

  const customerId = readStripeId(session.customer);
  const subscriptionId = readStripeId(session.subscription);
  const seatRaw = Number(metadata.instinctSeatCount ?? 1);
  const seatCount = Math.max(1, Number.isFinite(seatRaw) ? seatRaw : 1);

  await upsertEntitlement({
    subjectType,
    subjectId,
    plan,
    status: "active",
    seatCount,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  });

  if (subscriptionId) {
    const stripe = await Effect.runPromise(requireStripe());
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await applySubscription(subscription);
  }
}

export const handleStripeWebhook = Effect.fn("handleStripeWebhook")(function* (
  request: Request
) {
  const stripe = yield* requireStripe().pipe(
    Effect.mapError(
      (error) =>
        new BillingWebhookError({
          reason: "stripe_not_configured",
          message: error.message,
        })
    )
  );

  const secret = yield* stripeWebhookSecret().pipe(
    Effect.mapError(
      (error) =>
        new BillingWebhookError({
          reason: "stripe_not_configured",
          message: error.message,
        })
    )
  );

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return yield* new BillingWebhookError({
      reason: "invalid_signature",
      message: "Missing stripe-signature header.",
    });
  }

  const payload = yield* Effect.tryPromise({
    try: () => request.text(),
    catch: () =>
      new BillingWebhookError({
        reason: "invalid_signature",
        message: "Unable to read webhook body.",
      }),
  });

  const event = yield* Effect.try({
    try: () => stripe.webhooks.constructEvent(payload, signature, secret),
    catch: () =>
      new BillingWebhookError({
        reason: "invalid_signature",
        message: "Stripe signature verification failed.",
      }),
  });

  yield* Effect.tryPromise({
    try: async () => {
      switch (event.type) {
        case "checkout.session.completed": {
          // SAFETY: Stripe event.type discriminates Checkout.Session for this case.
          const session = event.data.object;
          await applyCheckoutSession(session);
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          // SAFETY: Stripe event.type discriminates Subscription for these cases.
          const subscription = event.data.object;
          await applySubscription(subscription);
          break;
        }

        default:
          break;
      }
    },
    catch: () =>
      new BillingWebhookError({
        reason: "unhandled",
        message: "Webhook handler failed while updating entitlements.",
      }),
  });

  return { received: true as const };
});
