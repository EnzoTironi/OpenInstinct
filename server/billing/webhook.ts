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

function subscriptionSeatCount(subscription: Stripe.Subscription) {
  const quantity = subscription.items.data[0]?.quantity ?? 1;

  const seatFromMeta = Number(
    subscription.metadata.instinctSeatCount ?? quantity
  );

  if (Number.isFinite(seatFromMeta)) return Math.max(1, seatFromMeta);

  return 1;
}

function defaultPlanForSubject(subjectType: BillingSubjectType): BillingPlanId {
  if (subjectType === "organization") return "org";

  return "pro";
}

async function resolveSubscriptionSubject(subscription: Stripe.Subscription) {
  const metadata = subscription.metadata;
  const resolvedType = parseSubjectType(metadata.instinctSubjectType);
  const resolvedId = metadata.instinctSubjectId;

  if (resolvedType && resolvedId) {
    return { subjectType: resolvedType, subjectId: resolvedId };
  }

  const existing = await findEntitlementByStripeSubscription(subscription.id);

  if (!existing) return null;

  return {
    subjectType: existing.subjectType,
    subjectId: existing.subjectId,
  };
}

async function applySubscription(subscription: Stripe.Subscription) {
  const subject = await resolveSubscriptionSubject(subscription);

  if (!subject) return;

  const plan = parsePlan(subscription.metadata.instinctPlan);
  const status = mapSubscriptionStatus(subscription.status);
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const itemPeriodEnd = subscription.items.data[0]?.current_period_end;

  await upsertEntitlement({
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    plan:
      status === "canceled"
        ? "free"
        : (plan ?? defaultPlanForSubject(subject.subjectType)),
    status,
    seatCount: subscriptionSeatCount(subscription),
    stripeCustomerId: readStripeId(subscription.customer),
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodEnd: itemPeriodEnd ? new Date(itemPeriodEnd * 1000) : null,
  });
}

function checkoutSeatCount(metadata: Stripe.Metadata) {
  const seatRaw = Number(metadata.instinctSeatCount ?? 1);

  if (Number.isFinite(seatRaw)) return Math.max(1, seatRaw);

  return 1;
}

function checkoutSubjects(metadata: Stripe.Metadata) {
  const plan = parsePlan(metadata.instinctPlan);
  const subjectType = parseSubjectType(metadata.instinctSubjectType);
  const subjectId = metadata.instinctSubjectId;

  if (!plan) return undefined;

  if (!subjectType) return undefined;

  if (!subjectId) return undefined;

  if (plan === "free") return undefined;

  return { plan, subjectId, subjectType };
}

async function syncCheckoutSubscription(subscriptionId: string | undefined) {
  if (!subscriptionId) return;

  const stripe = await Effect.runPromise(requireStripe());
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await applySubscription(subscription);
}

async function applyCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return;

  const metadata = session.metadata ?? {};
  const subjects = checkoutSubjects(metadata);

  if (!subjects) return;

  const subscriptionId = readStripeId(session.subscription);

  await upsertEntitlement({
    subjectType: subjects.subjectType,
    subjectId: subjects.subjectId,
    plan: subjects.plan,
    status: "active",
    seatCount: checkoutSeatCount(metadata),
    stripeCustomerId: readStripeId(session.customer),
    stripeSubscriptionId: subscriptionId,
  });

  await syncCheckoutSubscription(subscriptionId ?? undefined);
}

function stripeNotConfigured(message: string) {
  return new BillingWebhookError({
    reason: "stripe_not_configured",
    message,
  });
}

function invalidSignature(message: string) {
  return new BillingWebhookError({
    reason: "invalid_signature",
    message,
  });
}

async function processStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      // SAFETY: Stripe event.type discriminates Checkout.Session for this case.
      await applyCheckoutSession(event.data.object);

      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // SAFETY: Stripe event.type discriminates Subscription for these cases.
      await applySubscription(event.data.object);

      return;
    }

    default:
      return;
  }
}

function mapStripeNotConfigured(error: { message: string }) {
  return stripeNotConfigured(error.message);
}

function unableToReadWebhookBody() {
  return invalidSignature("Unable to read webhook body.");
}

function signatureVerificationFailed() {
  return invalidSignature("Stripe signature verification failed.");
}

function webhookHandlerFailed() {
  return new BillingWebhookError({
    reason: "unhandled",
    message: "Webhook handler failed while updating entitlements.",
  });
}

const loadStripeWebhookClients = Effect.fn("loadStripeWebhookClients")(
  function* () {
    const stripe = yield* requireStripe().pipe(
      Effect.mapError(mapStripeNotConfigured)
    );

    const secret = yield* stripeWebhookSecret().pipe(
      Effect.mapError(mapStripeNotConfigured)
    );

    return { stripe, secret } as const;
  }
);

const readSignedStripeEvent = Effect.fn("readSignedStripeEvent")(function* (
  request: Request,
  stripe: Stripe,
  secret: string
) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return yield* invalidSignature("Missing stripe-signature header.");
  }

  const payload = yield* Effect.tryPromise({
    try: request.text.bind(request),
    catch: unableToReadWebhookBody,
  });

  return yield* Effect.try({
    try: () => stripe.webhooks.constructEvent(payload, signature, secret),
    catch: signatureVerificationFailed,
  });
});

export const handleStripeWebhook = Effect.fn("handleStripeWebhook")(function* (
  request: Request
) {
  const { stripe, secret } = yield* loadStripeWebhookClients();
  const event = yield* readSignedStripeEvent(request, stripe, secret);

  yield* Effect.tryPromise({
    try: () => processStripeEvent(event),
    catch: webhookHandlerFailed,
  });

  return { received: true as const };
});
