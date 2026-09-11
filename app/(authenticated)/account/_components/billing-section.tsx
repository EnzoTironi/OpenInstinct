"use client";

import { billingPlanCatalog, type BillingPlanId } from "@shared/billing/plans";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { Option, Schema } from "effect";
import Link from "next/link";
import { useState } from "react";

const billingRedirectSchema = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

async function postBilling(
  path: string,
  body: {
    plan?: "pro" | "org";
    organizationId?: string;
    seatCount?: number;
  }
): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw: unknown = await response.json();
  const decoded = Schema.decodeUnknownOption(billingRedirectSchema)(raw);

  if (Option.isNone(decoded) || !decoded.value.url || !response.ok) {
    if (
      Option.isSome(decoded) &&
      decoded.value.reason === "stripe_not_configured"
    ) {
      throw new Error(
        "Paid billing is disabled on this deployment (Stripe not configured)."
      );
    }

    const message =
      Option.isSome(decoded) && decoded.value.error
        ? decoded.value.error
        : "Billing request failed.";

    throw new Error(message);
  }

  return decoded.value.url;
}

export function AccountBillingSection({
  plan,
  status,
  seatCount,
  organizationId,
  stripeCheckoutConfigured,
  stripePortalConfigured,
}: {
  readonly plan: BillingPlanId;
  readonly status: string;
  readonly seatCount: number;
  readonly organizationId?: string;
  readonly stripeCheckoutConfigured: boolean;
  readonly stripePortalConfigured: boolean;
}) {
  const [busy, setBusy] = useState<"pro" | "portal" | "org" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalog = billingPlanCatalog[plan];
  const seatLabel = String(seatCount);

  return (
    <section
      aria-labelledby="billing-heading"
      className="space-y-4"
      id="billing"
    >
      <div className="space-y-2">
        <h2 id="billing-heading" className="type-section-title">
          Plan and billing
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          Current plan: <span className="text-foreground">{catalog.name}</span>
          {plan === "org"
            ? ` · ${seatLabel} seat${seatCount === 1 ? "" : "s"}`
            : ""}
          {status !== "active" ? ` · status ${status}` : ""}. Free never
          requires a card.
          {stripeCheckoutConfigured
            ? " Paid upgrades use Stripe Checkout; manage renewals in the Customer Portal."
            : stripePortalConfigured
              ? " Paid Checkout stays disabled until Stripe Prices are configured; Customer Portal may still open for an existing customer."
              : " Paid Checkout and Customer Portal stay disabled until Stripe is configured."}
        </p>
      </div>

      {!stripeCheckoutConfigured || !stripePortalConfigured ? (
        <Alert variant="information">
          <AlertTitle>Stripe not fully configured</AlertTitle>
          <AlertDescription>
            {!stripeCheckoutConfigured
              ? "Upgrade / Checkout CTAs are off on this deployment. "
              : ""}
            {!stripePortalConfigured
              ? "Customer Portal CTA is off until STRIPE_SECRET_KEY is set. "
              : ""}
            Free continues without a card. Operators set{" "}
            <code className="type-caption">STRIPE_*</code> names only — never
            paste secret values into chat or git.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Billing</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {plan === "free" ? (
          <Button
            disabled={!stripeCheckoutConfigured || busy !== null}
            onClick={() => {
              if (!stripeCheckoutConfigured) return;
              setBusy("pro");
              setError(null);
              void postBilling("/api/billing/checkout", { plan: "pro" })
                .then((url) => {
                  window.location.assign(url);

                  return undefined;
                })
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to start Checkout."
                  );
                  setBusy(null);

                  return undefined;
                });
            }}
          >
            {!stripeCheckoutConfigured
              ? "Upgrade unavailable"
              : busy === "pro"
                ? "Redirecting…"
                : "Upgrade to Pro"}
          </Button>
        ) : null}
        {organizationId ? (
          <Button
            disabled={!stripeCheckoutConfigured || busy !== null}
            onClick={() => {
              if (!stripeCheckoutConfigured) return;
              setBusy("org");
              setError(null);
              void postBilling("/api/billing/checkout", {
                plan: "org",
                organizationId,
                seatCount: Math.max(1, seatCount),
              })
                .then((url) => {
                  window.location.assign(url);

                  return undefined;
                })
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to start Org Checkout."
                  );
                  setBusy(null);

                  return undefined;
                });
            }}
            variant="outline"
          >
            {!stripeCheckoutConfigured
              ? "Org seats unavailable"
              : busy === "org"
                ? "Redirecting…"
                : "Buy Org seats"}
          </Button>
        ) : null}
        <Button
          disabled={!stripePortalConfigured || busy !== null}
          onClick={() => {
            if (!stripePortalConfigured) return;
            setBusy("portal");
            setError(null);
            void postBilling("/api/billing/portal", {
              organizationId,
            })
              .then((url) => {
                window.location.assign(url);

                return undefined;
              })
              .catch((cause: unknown) => {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Unable to open Customer Portal."
                );
                setBusy(null);

                return undefined;
              });
          }}
          variant="outline"
        >
          {!stripePortalConfigured
            ? "Manage billing unavailable"
            : busy === "portal"
              ? "Redirecting…"
              : "Manage billing"}
        </Button>
        <Button render={<Link href="/pricing" />} variant="ghost">
          View pricing
        </Button>
      </div>
    </section>
  );
}
