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

const decodeOption_billingRedirectSchema = Schema.decodeUnknownOption(
  billingRedirectSchema
);

type BillingRedirect = Schema.Schema.Type<typeof billingRedirectSchema>;

function billingErrorMessage(decoded: Option.Option<BillingRedirect>): string {
  if (Option.isSome(decoded) && decoded.value.error) {
    return decoded.value.error;
  }

  return "Billing request failed.";
}

async function throwBillingHttpError(response: Response): Promise<never> {
  const raw: unknown = await response.json().catch(() => ({}));
  const decoded = decodeOption_billingRedirectSchema(raw);

  if (
    Option.isSome(decoded) &&
    decoded.value.reason === "stripe_not_configured"
  ) {
    throw new Error(
      "Paid billing is disabled on this deployment (Stripe not configured)."
    );
  }

  throw new Error(billingErrorMessage(decoded));
}

async function readBillingRedirectUrl(response: Response): Promise<string> {
  const raw: unknown = await response.json();
  const decoded = decodeOption_billingRedirectSchema(raw);

  if (Option.isSome(decoded) && decoded.value.url) {
    return decoded.value.url;
  }

  throw new Error(billingErrorMessage(decoded));
}

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

  if (!response.ok) {
    await throwBillingHttpError(response);
  }

  return readBillingRedirectUrl(response);
}

function StripeNotConfiguredAlert({
  stripeCheckoutConfigured,
  stripePortalConfigured,
}: {
  readonly stripeCheckoutConfigured: boolean;
  readonly stripePortalConfigured: boolean;
}) {
  if (stripeCheckoutConfigured && stripePortalConfigured) return null;

  return (
    <Alert variant="information">
      <AlertTitle>Stripe not fully configured</AlertTitle>
      <AlertDescription>
        {stripeCheckoutConfigured
          ? ""
          : "Upgrade / Checkout CTAs are off on this deployment. "}
        {stripePortalConfigured
          ? ""
          : "Customer Portal CTA is off until STRIPE_SECRET_KEY is set. "}
        Free continues without a card. Operators set{" "}
        <code className="type-caption">STRIPE_*</code> names only — never paste
        secret values into chat or git.
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

function BillingConfigurationAlerts({
  error,
  stripeCheckoutConfigured,
  stripePortalConfigured,
}: {
  readonly error: string | null;
  readonly stripeCheckoutConfigured: boolean;
  readonly stripePortalConfigured: boolean;
}) {
  return (
    <>
      <StripeNotConfiguredAlert
        stripeCheckoutConfigured={stripeCheckoutConfigured}
        stripePortalConfigured={stripePortalConfigured}
      />
      <BillingErrorAlert error={error} />
    </>
  );
}

function orgSeatSuffix(plan: BillingPlanId, seatCount: number): string {
  if (plan !== "org") return "";

  return ` · ${String(seatCount)} seat${seatCount === 1 ? "" : "s"}`;
}

function statusSuffix(status: string): string {
  if (status === "active") return "";

  return ` · status ${status}`;
}

function paidBillingBlurb(
  stripeCheckoutConfigured: boolean,
  stripePortalConfigured: boolean
): string {
  if (stripeCheckoutConfigured) {
    return " Paid upgrades use Stripe Checkout; manage renewals in the Customer Portal.";
  }

  if (stripePortalConfigured) {
    return " Paid Checkout stays disabled until Stripe Prices are configured; Customer Portal may still open for an existing customer.";
  }

  return " Paid Checkout and Customer Portal stay disabled until Stripe is configured.";
}

function BillingPlanSummary({
  plan,
  status,
  seatCount,
  stripeCheckoutConfigured,
  stripePortalConfigured,
}: {
  readonly plan: BillingPlanId;
  readonly status: string;
  readonly seatCount: number;
  readonly stripeCheckoutConfigured: boolean;
  readonly stripePortalConfigured: boolean;
}) {
  const catalog = billingPlanCatalog[plan];

  return (
    <p className="type-supporting-body text-muted-foreground">
      Current plan: <span className="text-foreground">{catalog.name}</span>
      {orgSeatSuffix(plan, seatCount)}
      {statusSuffix(status)}. Free never requires a card.
      {paidBillingBlurb(stripeCheckoutConfigured, stripePortalConfigured)}
    </p>
  );
}

type BillingBusy = "pro" | "portal" | "org" | null;

type BillingRequestBody =
  | { readonly plan: "pro" }
  | {
      readonly plan: "org";
      readonly organizationId: string;
      readonly seatCount: number;
    }
  | { readonly organizationId?: string };

function runBillingAction(options: {
  readonly kind: Exclude<BillingBusy, null>;
  readonly path: string;
  readonly body: BillingRequestBody;
  readonly fallback: string;
  readonly setBusy: (value: BillingBusy) => void;
  readonly setError: (value: string | null) => void;
}) {
  options.setBusy(options.kind);
  options.setError(null);
  void postBilling(options.path, options.body)
    .then((url) => {
      window.location.assign(url);

      return undefined;
    })
    .catch((cause: unknown) => {
      options.setError(
        cause instanceof Error ? cause.message : options.fallback
      );
      options.setBusy(null);

      return undefined;
    });
}

function UpgradeProButton({
  stripeCheckoutConfigured,
  busy,
  setBusy,
  setError,
}: {
  readonly stripeCheckoutConfigured: boolean;
  readonly busy: BillingBusy;
  readonly setBusy: (value: BillingBusy) => void;
  readonly setError: (value: string | null) => void;
}) {
  return (
    <Button
      disabled={!stripeCheckoutConfigured || busy !== null}
      onClick={() => {
        if (!stripeCheckoutConfigured) return;
        runBillingAction({
          kind: "pro",
          path: "/api/billing/checkout",
          body: { plan: "pro" },
          fallback: "Unable to start Checkout.",
          setBusy,
          setError,
        });
      }}
    >
      {!stripeCheckoutConfigured
        ? "Upgrade unavailable"
        : busy === "pro"
          ? "Redirecting…"
          : "Upgrade to Pro"}
    </Button>
  );
}

function BuyOrgSeatsButton({
  organizationId,
  seatCount,
  stripeCheckoutConfigured,
  busy,
  setBusy,
  setError,
}: {
  readonly organizationId: string;
  readonly seatCount: number;
  readonly stripeCheckoutConfigured: boolean;
  readonly busy: BillingBusy;
  readonly setBusy: (value: BillingBusy) => void;
  readonly setError: (value: string | null) => void;
}) {
  return (
    <Button
      disabled={!stripeCheckoutConfigured || busy !== null}
      onClick={() => {
        if (!stripeCheckoutConfigured) return;
        runBillingAction({
          kind: "org",
          path: "/api/billing/checkout",
          body: {
            plan: "org",
            organizationId,
            seatCount: Math.max(1, seatCount),
          },
          fallback: "Unable to start Org Checkout.",
          setBusy,
          setError,
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
  );
}

function ManageBillingButton({
  organizationId,
  stripePortalConfigured,
  busy,
  setBusy,
  setError,
}: {
  readonly organizationId?: string;
  readonly stripePortalConfigured: boolean;
  readonly busy: BillingBusy;
  readonly setBusy: (value: BillingBusy) => void;
  readonly setError: (value: string | null) => void;
}) {
  return (
    <Button
      disabled={!stripePortalConfigured || busy !== null}
      onClick={() => {
        if (!stripePortalConfigured) return;
        runBillingAction({
          kind: "portal",
          path: "/api/billing/portal",
          body: { organizationId },
          fallback: "Unable to open Customer Portal.",
          setBusy,
          setError,
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
  );
}

function BillingActionButtons({
  plan,
  seatCount,
  organizationId,
  stripeCheckoutConfigured,
  stripePortalConfigured,
  busy,
  setBusy,
  setError,
}: {
  readonly plan: BillingPlanId;
  readonly seatCount: number;
  readonly organizationId?: string;
  readonly stripeCheckoutConfigured: boolean;
  readonly stripePortalConfigured: boolean;
  readonly busy: BillingBusy;
  readonly setBusy: (value: BillingBusy) => void;
  readonly setError: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {plan === "free" ? (
        <UpgradeProButton
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          stripeCheckoutConfigured={stripeCheckoutConfigured}
        />
      ) : null}
      {organizationId ? (
        <BuyOrgSeatsButton
          busy={busy}
          organizationId={organizationId}
          seatCount={seatCount}
          setBusy={setBusy}
          setError={setError}
          stripeCheckoutConfigured={stripeCheckoutConfigured}
        />
      ) : null}
      <ManageBillingButton
        busy={busy}
        organizationId={organizationId}
        setBusy={setBusy}
        setError={setError}
        stripePortalConfigured={stripePortalConfigured}
      />
      <Button render={<Link href="/pricing" />} variant="ghost">
        View pricing
      </Button>
    </div>
  );
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
        <BillingPlanSummary
          plan={plan}
          seatCount={seatCount}
          status={status}
          stripeCheckoutConfigured={stripeCheckoutConfigured}
          stripePortalConfigured={stripePortalConfigured}
        />
      </div>

      <BillingConfigurationAlerts
        error={error}
        stripeCheckoutConfigured={stripeCheckoutConfigured}
        stripePortalConfigured={stripePortalConfigured}
      />

      <BillingActionButtons
        busy={busy}
        organizationId={organizationId}
        plan={plan}
        seatCount={seatCount}
        setBusy={setBusy}
        setError={setError}
        stripeCheckoutConfigured={stripeCheckoutConfigured}
        stripePortalConfigured={stripePortalConfigured}
      />
    </section>
  );
}
