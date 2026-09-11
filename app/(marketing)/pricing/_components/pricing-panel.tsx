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

function formatPrice(planId: BillingPlanId, amount: number) {
  if (planId === "free") return "Free";
  const dollars = String(amount);

  if (planId === "org") return `$${dollars}/seat · mo`;

  return `$${dollars}/mo`;
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

  if (!stripeConfigured) {
    return (
      <Button className="w-full" disabled variant="secondary">
        Checkout unavailable
      </Button>
    );
  }

  if (!signedIn) {
    return (
      <Button
        className="w-full"
        render={<Link href="/sign-in?callbackUrl=%2Fpricing" />}
      >
        Sign in to upgrade
      </Button>
    );
  }

  if (plan.id === "org") {
    return (
      <Button
        className="w-full"
        render={<Link href="/account#billing" />}
        variant={isCurrent ? "secondary" : "default"}
      >
        {isCurrent ? "Manage seats" : "Org seats via Account"}
      </Button>
    );
  }

  return (
    <Button
      className="w-full"
      disabled={busyPlan !== null}
      onClick={() => {
        onCheckout("pro");
      }}
      variant={isCurrent ? "secondary" : "default"}
    >
      {busyPlan === "pro"
        ? "Redirecting…"
        : isCurrent
          ? "Current plan"
          : "Upgrade to Pro"}
    </Button>
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
          {highlight ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 type-caption text-primary">
              Popular
            </span>
          ) : null}
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

  async function startCheckout(plan: "pro" | "org") {
    setBusyPlan(plan);
    setError(null);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan,
          seatCount: plan === "org" ? 1 : undefined,
        }),
      });

      if (!response.ok) {
        const raw: unknown = await response.json().catch(() => ({}));
        const decoded = decodeOption_checkoutResponseSchema(raw);
        const body = Option.isSome(decoded) ? decoded.value : {};

        if (body.reason === "stripe_not_configured") {
          setError(
            "Paid Checkout is disabled on this deployment (Stripe not configured). Free still works."
          );
        } else if (body.reason === "org_required") {
          setError(
            "Org seats need an organization first. Create one under Account, then retry with that org."
          );
        } else {
          setError(body.error ?? "Unable to start Checkout.");
        }

        return;
      }

      const raw: unknown = await response.json();
      const decoded = decodeOption_checkoutResponseSchema(raw);
      const body = Option.isSome(decoded) ? decoded.value : {};

      if (!body.url) {
        setError(body.error ?? "Unable to start Checkout.");

        return;
      }

      window.location.assign(body.url);
    } catch {
      setError(
        "Unable to start Checkout. Check your connection and try again."
      );
    } finally {
      setBusyPlan(null);
    }
  }

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

      {!stripeConfigured ? (
        <Alert variant="information">
          <AlertTitle>Paid upgrades disabled</AlertTitle>
          <AlertDescription>
            Stripe Checkout is not configured on this deployment (
            <code className="type-caption">STRIPE_*</code> unset). Free still
            works with no card. Upgrade and Customer Portal CTAs stay off so
            Checkout cannot start broken.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Billing</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PricingPlanCard
            busyPlan={busyPlan}
            currentPlan={currentPlan}
            key={plan.id}
            onCheckout={(next) => {
              void startCheckout(next);
            }}
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
        {stripeConfigured
          ? "Already paying? Manage payment method and cancellation in Account via Stripe Customer Portal. Self-host stays on operator quotas — see docs."
          : "Paid billing stays off until an operator configures Stripe. Self-host stays on operator quotas — see docs."}
      </p>
    </section>
  );
}
