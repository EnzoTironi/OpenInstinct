"use client";

import { useI18n } from "@web/i18n/context";
import Link from "next/link";
import { Button } from "@web/components/ui/button";
import { OnboardingTrigger } from "../../_components/onboarding";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card";
import {
  MarketingFrame,
  MarketingShell,
} from "../../_components/marketing-shell";
import { companionPublicOrigin } from "../../public-origin";

const steps = [
  {
    title: "Toque em Começar",
    body: "Escolha seu mensageiro no painel que abre aqui mesmo. Depois, faça seu primeiro pedido na conversa.",
  },
  {
    title: "Faça seu primeiro pedido",
    body: "Mande uma mensagem, um áudio ou algo que você quer organizar. A conversa começa ali mesmo.",
  },
  {
    title: "Continue de onde parou",
    body: "Quando precisar de uma conexão, o Zoen pede na própria conversa. Se quiser assinar depois, você recebe um link do Stripe com o valor antes de pagar.",
  },
] as const;

const links = [
  {
    href: "/sign-in",
    title: "Acessar minha conta",
    body: "Gerencie suas conexões, memória e assinatura quando precisar.",
  },
] as const;

export function DocsPanel() {
  const { t } = useI18n();
  return (
    <MarketingShell active="docs">
      <main>
        <MarketingFrame className="flex max-w-3xl flex-col gap-16 py-16 sm:py-24">
          <header className="flex flex-col gap-5">
            <p className="type-caption text-muted-foreground">{t("Guia")}</p>
            <h1 className="type-signal text-4xl tracking-tight sm:text-5xl lg:leading-[1.05]">
              {t("Primeiros passos")}
            </h1>
            <p className="type-body text-lg text-muted-foreground">
              {t("Seu primeiro pedido ao")}{" "}
              <a
                className="underline-offset-4 hover:text-foreground hover:underline"
                href={companionPublicOrigin}
              >
                Zoen
              </a>{" "}
              {t("começa no seu mensageiro.")}
            </p>
            <div className="flex flex-wrap gap-3">
              <OnboardingTrigger>{t("Começar agora")}</OnboardingTrigger>
              <Button
                nativeButton={false}
                render={<Link href="/welcome" />}
                variant="outline"
              >
                {t("Voltar ao produto")}
              </Button>
            </div>
          </header>

          <section
            aria-labelledby="flow-heading"
            className="flex flex-col gap-6"
          >
            <h2
              className="type-signal text-3xl tracking-tight"
              id="flow-heading"
            >
              {t("Fluxo")}
            </h2>
            <ol className="flex flex-col gap-4">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <Card>
                    <CardHeader className="grid grid-cols-[auto_1fr] items-start gap-4">
                      <span
                        aria-hidden="true"
                        className="flex size-9 items-center justify-center rounded-full bg-muted type-label"
                      >
                        {index + 1}
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <CardTitle>{t(step.title)}</CardTitle>
                        <CardDescription>{t(step.body)}</CardDescription>
                      </div>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="trust-docs-heading"
            className="flex flex-col gap-4"
          >
            <h2
              className="type-signal text-3xl tracking-tight"
              id="trust-docs-heading"
            >
              {t("Notas de confiança")}
            </h2>
            <ul className="type-supporting-body flex flex-col gap-3 text-muted-foreground">
              <li>
                {t(
                  "Uma assinatura só começa depois da sua confirmação no Stripe."
                )}
              </li>
              <li>
                {t(
                  "Sua conta permite consultar e apagar a memória pessoal salva. Esse controle cobre a memória pessoal, sem apagar toda a conta."
                )}
              </li>
              <li>
                {t(
                  "Você pode gerenciar ou cancelar sua assinatura pelo portal do Stripe, acessível na sua conta."
                )}
              </li>
            </ul>
          </section>

          <section
            aria-labelledby="related-heading"
            className="flex flex-col gap-4"
          >
            <h2
              className="type-signal text-3xl tracking-tight"
              id="related-heading"
            >
              {t("Relacionados")}
            </h2>
            <ul className="grid gap-3">
              {links.map((item) => (
                <li key={item.href}>
                  <Link className="block" href={item.href} prefetch={false}>
                    <Card className="transition-colors hover:bg-muted/40">
                      <CardHeader>
                        <CardTitle>{t(item.title)}</CardTitle>
                        <CardDescription>{t(item.body)}</CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </MarketingFrame>
      </main>
    </MarketingShell>
  );
}
