"use client";

import { billingPlanCatalog, type BillingPlanId } from "@shared/billing/plans";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card";
import { Option, Schema } from "effect";
import Link from "next/link";
import { useState } from "react";

const plans = [
  billingPlanCatalog.free,
  billingPlanCatalog.pro,
  billingPlanCatalog.org,
] as const;

type Plan = (typeof plans)[number];

const checkoutResponseSchema = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

const decodeOption_checkoutResponseSchema = Schema.decodeUnknownOption(
  checkoutResponseSchema
);

interface CheckoutBody {
  readonly error?: string;
  readonly reason?: string;
  readonly url?: string;
}

function formatPrice(planId: BillingPlanId, amount: number) {
  if (planId === "free") return "Free";
  const dollars = String(amount);

  if (planId === "org") return `$${dollars}/seat · mo`;

  return `$${dollars}/mo`;
}

function FreePlanAction({
  signedIn,
  isCurrent,
}: {
  readonly signedIn: boolean;
  readonly isCurrent: boolean;
}) {
  return (
    <Button
      className="w-full"
      render={<Link href={signedIn ? "/account" : "/get-started"} />}
      variant={isCurrent ? "secondary" : "outline"}
    >
      {isCurrent ? "Current plan" : "Start free"}
    </Button>
  );
}

function UnavailableCheckoutButton() {
  return (
    <Button className="w-full" disabled variant="secondary">
      Checkout unavailable
    </Button>
  );
}

function SignInToUpgradeButton() {
  return (
    <Button
      className="w-full"
      render={<Link href="/sign-in?callbackUrl=%2Fpricing" />}
    >
      Sign in to upgrade
    </Button>
  );
}

function orgPlanLabel(isCurrent: boolean) {
  if (isCurrent) return "Manage seats";

  return "Org seats via Account";
}

function OrgPlanButton({ isCurrent }: { readonly isCurrent: boolean }) {
  return (
    <Button
      className="w-full"
      render={<Link href="/account#billing" />}
      variant={isCurrent ? "secondary" : "default"}
    >
      {orgPlanLabel(isCurrent)}
    </Button>
  );
}

function proPlanLabel(busyPlan: BillingPlanId | null, isCurrent: boolean) {
  if (busyPlan === "pro") return "Redirecting…";

  if (isCurrent) return "Current plan";

  return "Upgrade to Pro";
}

function makeProCheckout(onCheckout: (plan: "pro") => void) {
  return () => {
    onCheckout("pro");
  };
}

function ProPlanButton({
  busyPlan,
  isCurrent,
  onCheckout,
}: {
  readonly busyPlan: BillingPlanId | null;
  readonly isCurrent: boolean;
  readonly onCheckout: (plan: "pro") => void;
}) {
  return (
    <Button
      className="w-full"
      disabled={busyPlan !== null}
      onClick={makeProCheckout(onCheckout)}
      variant={isCurrent ? "secondary" : "default"}
    >
      {proPlanLabel(busyPlan, isCurrent)}
    </Button>
  );
}

function PaidPlanAction({
  planId,
  signedIn,
  isCurrent,
  stripeConfigured,
  busyPlan,
  onCheckout,
}: {
  readonly planId: "pro" | "org";
  readonly signedIn: boolean;
  readonly isCurrent: boolean;
  readonly stripeConfigured: boolean;
  readonly busyPlan: BillingPlanId | null;
  readonly onCheckout: (plan: "pro" | "org") => void;
}) {
  if (!stripeConfigured) return <UnavailableCheckoutButton />;

  if (!signedIn) return <SignInToUpgradeButton />;

  if (planId === "org") return <OrgPlanButton isCurrent={isCurrent} />;

  return (
    <ProPlanButton
      busyPlan={busyPlan}
      isCurrent={isCurrent}
      onCheckout={onCheckout}
    />
  );
}

function PlanAction({
  plan,
  signedIn,
  currentPlan,
  stripeConfigured,
  busyPlan,
  onCheckout,
}: {
  readonly plan: Plan;
  readonly signedIn: boolean;
  readonly currentPlan: BillingPlanId;
  readonly stripeConfigured: boolean;
  readonly busyPlan: BillingPlanId | null;
  readonly onCheckout: (plan: "pro" | "org") => void;
}) {
  const isCurrent = currentPlan === plan.id;

  if (plan.id === "free") {
    return <FreePlanAction isCurrent={isCurrent} signedIn={signedIn} />;
  }

  return (
    <PaidPlanAction
      busyPlan={busyPlan}
      isCurrent={isCurrent}
      onCheckout={onCheckout}
      planId={plan.id}
      signedIn={signedIn}
      stripeConfigured={stripeConfigured}
    />
  );
}

function PopularBadge({ highlight }: { readonly highlight: boolean }) {
  if (!highlight) return null;

  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 type-caption text-primary">
      Popular
    </span>
  );
}

function PricingPlanCard({
  plan,
  signedIn,
  currentPlan,
  stripeConfigured,
  busyPlan,
  onCheckout,
}: {
  readonly plan: Plan;
  readonly signedIn: boolean;
  readonly currentPlan: BillingPlanId;
  readonly stripeConfigured: boolean;
  readonly busyPlan: BillingPlanId | null;
  readonly onCheckout: (plan: "pro" | "org") => void;
}) {
  const highlight = plan.id === "pro";

  return (
    <Card
      className={
        highlight
          ? "border-primary/40 shadow-sm ring-1 ring-primary/20"
          : undefined
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{plan.name}</CardTitle>
          <PopularBadge highlight={highlight} />
        </div>
        <CardDescription>{plan.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="type-section-title">
          {formatPrice(plan.id, plan.placeholderPriceUsdMonthly)}
        </p>
        <ul className="space-y-2">
          {plan.features.map((feature) => (
            <li className="type-caption text-muted-foreground" key={feature}>
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <PlanAction
          busyPlan={busyPlan}
          currentPlan={currentPlan}
          onCheckout={onCheckout}
          plan={plan}
          signedIn={signedIn}
          stripeConfigured={stripeConfigured}
        />
      </CardFooter>
    </Card>
  );
}

function checkoutFailureMessage(body: CheckoutBody) {
  if (body.reason === "stripe_not_configured") {
    return "Paid Checkout is disabled on this deployment (Stripe not configured). Free still works.";
  }

  if (body.reason === "org_required") {
    return "Org seats need an organization first. Create one under Account, then retry with that org.";
  }

  return body.error ?? "Unable to start Checkout.";
}

function checkoutSeatCount(plan: "pro" | "org") {
  if (plan === "org") return 1;

  return undefined;
}

function checkoutBodyFromDecoded(
  decoded: ReturnType<typeof decodeOption_checkoutResponseSchema>
): CheckoutBody {
  if (Option.isSome(decoded)) return decoded.value;

  return {};
}

async function readCheckoutJson(response: Response): Promise<CheckoutBody> {
  try {
    // SAFETY: Response.json() is untyped fetch I/O; Schema.decodeUnknownOption validates next.
    const raw = (await response.json()) as unknown;

    return checkoutBodyFromDecoded(decodeOption_checkoutResponseSchema(raw));
  } catch {
    return {};
  }
}

async function readCheckoutError(response: Response) {
  return checkoutFailureMessage(await readCheckoutJson(response));
}

async function readCheckoutSuccess(response: Response) {
  const body = await readCheckoutJson(response);

  if (!body.url) {
    return { error: body.error ?? "Unable to start Checkout." } as const;
  }

  return { url: body.url } as const;
}

async function postCheckout(plan: "pro" | "org") {
  return fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      plan,
      seatCount: checkoutSeatCount(plan),
    }),
  });
}

async function runCheckout(
  plan: "pro" | "org",
  setError: (value: string | null) => void
) {
  const response = await postCheckout(plan);

  if (!response.ok) {
    setError(await readCheckoutError(response));

    return;
  }

  const result = await readCheckoutSuccess(response);

  if ("error" in result) {
    setError(result.error ?? null);

    return;
  }

  window.location.assign(result.url);
}

function billingFooterCopy(stripeConfigured: boolean) {
  if (stripeConfigured) {
    return "Already paying? Manage payment method and cancellation in Account via Stripe Customer Portal. Self-host stays on operator quotas — see docs.";
  }

  return "Paid billing stays off until an operator configures Stripe. Self-host stays on operator quotas — see docs.";
}

function StripeDisabledAlert({
  stripeConfigured,
}: {
  readonly stripeConfigured: boolean;
}) {
  if (stripeConfigured) return null;

  return (
    <Alert variant="information">
      <AlertTitle>Paid upgrades disabled</AlertTitle>
      <AlertDescription>
        Stripe Checkout is not configured on this deployment (
        <code className="type-caption">STRIPE_*</code> unset). Free still works
        with no card. Upgrade and Customer Portal CTAs stay off so Checkout
        cannot start broken.
      </AlertDescription>
    </Alert>
  );
}

function BillingErrorAlert({ error }: { readonly error: string | null }) {
  if (!error) return null;

  return (
    <Alert variant="destructive">
      <AlertTitle>Billing</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function makeCheckoutHandler(
  setBusyPlan: (value: BillingPlanId | null) => void,
  setError: (value: string | null) => void
) {
  return (plan: "pro" | "org") => {
    void (async () => {
      setBusyPlan(plan);
      setError(null);

      try {
        await runCheckout(plan, setError);
      } catch {
        setError(
          "Unable to start Checkout. Check your connection and try again."
        );
      } finally {
        setBusyPlan(null);
      }
    })();
  };
}

export function PricingPanel({
  signedIn,
  currentPlan,
  stripeConfigured,
}: {
  readonly signedIn: boolean;
  readonly currentPlan: BillingPlanId;
  readonly stripeConfigured: boolean;
}) {
  const [busyPlan, setBusyPlan] = useState<BillingPlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onCheckout = makeCheckoutHandler(setBusyPlan, setError);

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
      <header className="space-y-3 text-center">
        <p className="type-caption text-muted-foreground">Pricing</p>
        <h1 className="type-page-title">
          Free to start, more when you’re ready
        </h1>
        <p className="type-supporting-body mx-auto max-w-2xl text-muted-foreground">
          Every plan gets Companion. Start free with no card, then step up for
          higher personal quotas (Pro) or seat-based team access (Org). List
          prices are placeholders until Stripe Prices are wired in the
          dashboard.
        </p>
      </header>

      <StripeDisabledAlert stripeConfigured={stripeConfigured} />
      <BillingErrorAlert error={error} />

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PricingPlanCard
            busyPlan={busyPlan}
            currentPlan={currentPlan}
            key={plan.id}
            onCheckout={onCheckout}
            plan={plan}
            signedIn={signedIn}
            stripeConfigured={stripeConfigured}
          />
        ))}
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/20 p-6 text-center">
        <p className="type-label">New here?</p>
        <p className="type-supporting-body mt-2 text-muted-foreground">
          Follow the consumer first-run: bind Telegram or WhatsApp, then message
          Companion. No self-hosting required.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Button
            nativeButton={false}
            render={<Link href="/docs" />}
            variant="outline"
          >
            Read docs
          </Button>
          <Button nativeButton={false} render={<Link href="/get-started" />}>
            Get started
          </Button>
        </div>
      </div>

      <p className="text-center type-caption text-muted-foreground">
        {billingFooterCopy(stripeConfigured)}
      </p>
    </section>
  );
}
