"use client";

import { useI18n } from "@web/i18n/context";

import { useState } from "react";
import { Option, Schema } from "effect";
import { billingPlanCatalog, type BillingPlanId } from "@shared/billing/plans";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";

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
      throw new Error("Planos pagos não estão disponíveis no momento.");
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
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<"pro" | "portal" | "org" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalog = billingPlanCatalog[plan];
  const seatLabel = seatCount.toLocaleString(locale);

  return (
    <section
      aria-labelledby="billing-heading"
      className="space-y-4"
      id="billing"
    >
      <div className="space-y-2">
        <h2 id="billing-heading" className="type-section-title">
          <span id="plan">{t("Seu plano")}</span>
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          {t("Plano atual:")}{" "}
          <span className="text-foreground">{t(catalog.name)}</span>
          {plan === "org"
            ? ` · ${t("Assentos: {count}", { count: seatLabel })}`
            : ""}
          {status !== "active" ? ` · ${t(status)}` : ""}
          {t(". O plano gratuito não precisa de cartão.")}
        </p>
      </div>

      {!stripeCheckoutConfigured && !stripePortalConfigured ? (
        <p className="type-supporting-body rounded-2xl bg-muted p-5 text-muted-foreground">
          {t(
            "As alterações de plano ainda não estão disponíveis. Você pode continuar usando seu plano atual."
          )}
        </p>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("Assinatura")}</AlertTitle>
          <AlertDescription>{t(error)}</AlertDescription>
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
                      : t("Unable to start Checkout.")
                  );
                  setBusy(null);
                  return undefined;
                });
            }}
          >
            {!stripeCheckoutConfigured
              ? t("Alteração indisponível")
              : busy === "pro"
                ? t("Abrindo…")
                : t("Mudar para Pro")}
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
                      : t("Unable to start Org Checkout.")
                  );
                  setBusy(null);
                  return undefined;
                });
            }}
            variant="outline"
          >
            {!stripeCheckoutConfigured
              ? t("Assentos indisponíveis")
              : busy === "org"
                ? t("Abrindo…")
                : t("Adicionar pessoas")}
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
                    : t("Unable to open Customer Portal.")
                );
                setBusy(null);
                return undefined;
              });
          }}
          variant="outline"
        >
          {!stripePortalConfigured
            ? t("Gestão indisponível")
            : busy === "portal"
              ? t("Abrindo…")
              : t("Gerenciar assinatura")}
        </Button>
      </div>
    </section>
  );
}
