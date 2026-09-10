"use client";

import Link from "next/link";
import { Option, Schema } from "effect";
import { useState } from "react";
import { billingPlanCatalog, type BillingPlanId } from "@shared/billing/plans";
import { Button } from "@web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";

const plans = [
  billingPlanCatalog.free,
  billingPlanCatalog.pro,
  billingPlanCatalog.org,
] as const;

const checkoutResponseSchema = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

function formatPrice(planId: BillingPlanId, amount: number) {
  if (planId === "free") return "Free";
  const dollars = String(amount);
  if (planId === "org") return `$${dollars}/seat · mo`;
  return `$${dollars}/mo`;
}

export function PricingPanel({
  signedIn,
  currentPlan,
}: {
  readonly signedIn: boolean;
  readonly currentPlan: BillingPlanId;
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
      const raw: unknown = await response.json();
      const decoded = Schema.decodeUnknownOption(checkoutResponseSchema)(raw);
      const body = Option.isSome(decoded) ? decoded.value : {};
      if (!response.ok || !body.url) {
        if (body.reason === "org_required") {
          setError(
            "Org seats need an organization first. Create one under Account, then retry with that org."
          );
        } else {
          setError(body.error ?? "Unable to start Checkout.");
        }
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
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <header className="space-y-2 text-center">
        <p className="type-caption text-muted-foreground">Companion</p>
        <h1 className="type-page-title">Pricing</h1>
        <p className="type-supporting-body mx-auto max-w-2xl text-muted-foreground">
          Free works without a card. Pro raises personal quotas. Org sells seats
          for teams. List prices below are placeholders until Stripe Prices are
          wired in the dashboard.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Billing</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          return (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="type-section-title">
                  {formatPrice(plan.id, plan.placeholderPriceUsdMonthly)}
                </p>
                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      className="type-caption text-muted-foreground"
                      key={feature}
                    >
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {plan.id === "free" ? (
                  <Button
                    className="w-full"
                    render={
                      <Link href={signedIn ? "/account" : "/get-started"} />
                    }
                    variant={isCurrent ? "secondary" : "outline"}
                  >
                    {isCurrent ? "Current plan" : "Start free"}
                  </Button>
                ) : !signedIn ? (
                  <Button
                    className="w-full"
                    render={<Link href="/sign-in?callbackUrl=%2Fpricing" />}
                  >
                    Sign in to upgrade
                  </Button>
                ) : plan.id === "org" ? (
                  <Button
                    className="w-full"
                    render={<Link href="/account#billing" />}
                    variant={isCurrent ? "secondary" : "default"}
                  >
                    {isCurrent ? "Manage seats" : "Org seats via Account"}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    disabled={busyPlan !== null}
                    onClick={() => {
                      void startCheckout("pro");
                    }}
                    variant={isCurrent ? "secondary" : "default"}
                  >
                    {busyPlan === "pro"
                      ? "Redirecting…"
                      : isCurrent
                        ? "Current plan"
                        : "Upgrade to Pro"}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <p className="text-center type-caption text-muted-foreground">
        Already paying? Manage payment method and cancellation in Account via
        Stripe Customer Portal. Self-host stays on operator quotas — see docs.
      </p>
    </section>
  );
}
