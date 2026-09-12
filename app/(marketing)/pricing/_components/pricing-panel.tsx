"use client";

import Link from "next/link";
import { Option, Schema } from "effect";
import { useState } from "react";
import { billingPlanCatalog, type BillingPlanId } from "@shared/billing/plans";
import { Button } from "@web/components/ui/button";
import { Badge } from "@web/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { MarketingFrame } from "../../_components/marketing-shell";
import {
  marketingPlanOrder,
  marketingPriceLabel,
} from "../../_components/plan-copy";
import {
  companionPublicHost,
  companionPublicOrigin,
} from "../../public-origin";

const checkoutResponseSchema = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

const faqs = [
  {
    question: "Preciso de cartão no Free?",
    answer:
      "Não. O Free nunca pede cartão. Pro e Org só cobram quando o Stripe está configurado neste deploy.",
  },
  {
    question: "Onde o produto está hospedado?",
    answer: `Em ${companionPublicHost}. Começar, entrar, preços e guia usam esse host — não outro domínio de produto.`,
  },
  {
    question: "E se o Checkout pago estiver desligado?",
    answer:
      "Os botões de upgrade ficam desligados de propósito. O Free continua. Self-host segue nas cotas de operador — veja o guia.",
  },
] as const;

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
      const raw: unknown = await response.json();
      const decoded = Schema.decodeUnknownOption(checkoutResponseSchema)(raw);
      const body = Option.isSome(decoded) ? decoded.value : {};
      if (!response.ok || !body.url) {
        if (body.reason === "stripe_not_configured") {
          setError(
            "O Checkout pago está desligado neste deploy (Stripe não configurado). O Free continua valendo."
          );
        } else if (body.reason === "org_required") {
          setError(
            "Assentos Org pedem uma organização. Crie uma em Conta e tente de novo com essa org."
          );
        } else {
          setError(body.error ?? "Não foi possível iniciar o Checkout.");
        }
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError(
        "Não foi possível iniciar o Checkout. Confira a conexão e tente de novo."
      );
    } finally {
      setBusyPlan(null);
    }
  }

  return (
    <main>
      <MarketingFrame
        as="section"
        className="flex flex-col gap-12 py-16 sm:py-24"
      >
        <header className="mx-auto flex max-w-2xl flex-col gap-4 text-center">
          <p className="type-caption text-muted-foreground">Preços</p>
          <h1 className="type-signal text-4xl tracking-tight sm:text-5xl lg:text-6xl lg:leading-[1.05]">
            Comece grátis. Suba quando precisar.
          </h1>
          <p className="type-body text-lg text-muted-foreground">
            Todo plano traz o Companion. Free sem cartão. Pro aumenta cotas
            pessoais. Org vende assentos para times. Os valores listados são
            placeholders até os Prices do Stripe no dashboard.
          </p>
        </header>

        {!stripeConfigured ? (
          <Alert variant="information">
            <AlertTitle>Upgrade pago desligado</AlertTitle>
            <AlertDescription>
              O Stripe Checkout não está configurado neste deploy (
              <code className="type-caption">STRIPE_*</code> ausente). O Free
              continua sem cartão. Os CTAs de upgrade e do Customer Portal ficam
              desligados para o Checkout não abrir quebrado.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Cobrança</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          {marketingPlanOrder.map((plan) => {
            const isCurrent = signedIn && currentPlan === plan.id;
            const highlight = plan.id === "pro";
            const amount =
              billingPlanCatalog[plan.id].placeholderPriceUsdMonthly;
            return (
              <Card
                className={highlight ? "ring-1 ring-primary/25" : undefined}
                key={plan.id}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{plan.name}</CardTitle>
                    {highlight ? (
                      <Badge variant="information">Popular</Badge>
                    ) : null}
                  </div>
                  <CardDescription>{plan.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <p className="type-signal text-4xl tracking-tight">
                      {marketingPriceLabel(plan.id, amount)}
                    </p>
                    <p className="type-caption text-muted-foreground">
                      {plan.cadence}
                    </p>
                  </div>
                  <p className="type-caption text-muted-foreground">Inclui:</p>
                  <ul className="flex flex-col gap-2">
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
                      nativeButton={false}
                      render={
                        <Link href={signedIn ? "/account" : "/get-started"} />
                      }
                      variant={isCurrent ? "secondary" : "outline"}
                    >
                      {isCurrent ? "Plano atual" : "Começar grátis"}
                    </Button>
                  ) : !stripeConfigured ? (
                    <Button className="w-full" disabled variant="secondary">
                      Checkout indisponível
                    </Button>
                  ) : !signedIn ? (
                    <Button
                      className="w-full"
                      nativeButton={false}
                      render={<Link href="/sign-in?callbackUrl=%2Fpricing" />}
                    >
                      Entrar para assinar
                    </Button>
                  ) : plan.id === "org" ? (
                    <Button
                      className="w-full"
                      nativeButton={false}
                      render={<Link href="/account#billing" />}
                      variant={isCurrent ? "secondary" : "default"}
                    >
                      {isCurrent
                        ? "Gerenciar assentos"
                        : "Assentos Org na Conta"}
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
                        ? "Redirecionando…"
                        : isCurrent
                          ? "Plano atual"
                          : "Assinar Pro"}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle>Chegou agora?</CardTitle>
            <CardDescription>
              Primeiros passos no host {companionPublicHost}: vincule Telegram
              ou WhatsApp e fale com o Companion. Sem self-host.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-center gap-3">
            <Button
              nativeButton={false}
              render={<Link href="/docs" />}
              variant="outline"
            >
              Ler o guia
            </Button>
            <Button nativeButton={false} render={<Link href="/get-started" />}>
              Começar
            </Button>
          </CardContent>
        </Card>

        <section aria-labelledby="faq-heading" className="flex flex-col gap-6">
          <h2
            className="type-signal text-2xl tracking-tight sm:text-3xl"
            id="faq-heading"
          >
            Perguntas
          </h2>
          <dl className="grid gap-4 md:grid-cols-3">
            {faqs.map((item) => (
              <Card key={item.question}>
                <CardHeader>
                  <dt>
                    <CardTitle>{item.question}</CardTitle>
                  </dt>
                  <dd>
                    <CardDescription>{item.answer}</CardDescription>
                  </dd>
                </CardHeader>
              </Card>
            ))}
          </dl>
        </section>

        <p className="text-center type-caption text-muted-foreground">
          {stripeConfigured
            ? "Já paga? Método e cancelamento ficam em Conta, no Stripe Customer Portal. Self-host segue nas cotas de operador — veja o guia."
            : "A cobrança paga fica desligada até um operador configurar o Stripe. Self-host segue nas cotas de operador — veja o guia."}{" "}
          Host:{" "}
          <a
            className="underline-offset-4 hover:text-foreground hover:underline"
            href={companionPublicOrigin}
          >
            {companionPublicHost}
          </a>
          .
        </p>
      </MarketingFrame>
    </main>
  );
}
