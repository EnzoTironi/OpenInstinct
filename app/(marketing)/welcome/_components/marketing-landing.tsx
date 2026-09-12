import Link from "next/link";
import {
  Building2Icon,
  GlobeIcon,
  LockIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  UserIcon,
} from "lucide-react";
import { Button } from "@web/components/ui/button";
import { Badge } from "@web/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card";
import { billingPlanCatalog } from "@shared/billing/plans";
import {
  MarketingFrame,
  MarketingShell,
} from "../../_components/marketing-shell";
import {
  marketingPlanOrder,
  marketingPriceLabel,
} from "../../_components/plan-copy";
import {
  companionPublicHost,
  companionPublicOrigin,
} from "../../public-origin";
import { ChatPreview } from "./chat-preview";

const channels = [
  {
    title: "Telegram",
    body: "O Companion mora no chat que você já abre. Sem app novo para aprender.",
    icon: MessageCircleIcon,
  },
  {
    title: "WhatsApp",
    body: "O mesmo assistente, no outro messenger. Você escolhe a porta da frente.",
    icon: SmartphoneIcon,
  },
  {
    title: "Web",
    body: `Conta, plano e guia em ${companionPublicHost} — o host de produção.`,
    icon: GlobeIcon,
  },
] as const;

const fit = [
  {
    title: "Nos chats que você já usa",
    body: "Telegram e WhatsApp são a porta. O Companion responde onde o trabalho já acontece.",
  },
  {
    title: "Aprende como você trabalha",
    body: "Contexto no workspace pessoal. Sem ritual de prompt para cada pedido.",
  },
  {
    title: "Nada sensível sem aprovação",
    body: "Envios e mudanças que pedem a sua voz esperam o ok. Você manda no ritmo.",
  },
  {
    title: "Sobe quando o ritmo aumenta",
    body: "Free para começar. Pro e Org quando a cota pessoal ou o time pedem mais.",
  },
] as const;

const steps = [
  {
    title: "Comece grátis",
    body: "Abra Começar. Sem cartão. Uma conta no navegador, no host companion.tironi.xyz.",
  },
  {
    title: "Vincule um canal",
    body: "Confirme no Telegram ou no WhatsApp. Esse messenger vira a porta da frente.",
  },
  {
    title: "Peça algo real",
    body: "O Companion responde no chat — em geral em minutos, não em um tour de produto.",
  },
] as const;

const trust = [
  {
    title: "Free nunca pede cartão",
    body: "Upgrade pago usa Stripe Checkout. Gerencie ou cancele no Customer Portal.",
    icon: LockIcon,
  },
  {
    title: "Você aprova o que é sensível",
    body: "O Companion pergunta antes de enviar ou mudar o que precisa da sua voz.",
    icon: ShieldCheckIcon,
  },
  {
    title: "Privacidade com limite honesto",
    body: "Exportar e apagar cobrem a memória pessoal hoje — ainda não o histórico inteiro.",
    icon: UserIcon,
  },
] as const;

const audiences = [
  {
    title: "Pessoas",
    body: "Um Companion pessoal no Telegram ou no WhatsApp.",
    icon: UserIcon,
  },
  {
    title: "Profissionais",
    body: "Mais cota quando o assistente entra no ritmo do trabalho.",
    icon: SparklesIcon,
  },
  {
    title: "Times",
    body: "Assentos Org, workspaces compartilhados e cobrança de admin.",
    icon: Building2Icon,
  },
] as const;

export function MarketingLanding() {
  return (
    <MarketingShell active="product">
      <main>
        <section className="pt-16 pb-20 sm:pt-24 sm:pb-28">
          <MarketingFrame className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
            <div className="flex flex-col gap-6">
              <p className="type-caption text-muted-foreground">
                Companion by Instinct
              </p>
              <h1 className="type-signal max-w-xl text-4xl tracking-tight sm:text-5xl lg:text-6xl lg:leading-[1.05]">
                Conheça o Companion, seu assistente no trabalho
              </h1>
              <p className="type-body max-w-lg text-lg text-muted-foreground">
                Encaixa no Telegram e no WhatsApp. Aprende como você trabalha —
                depois trabalha. Para pessoas, profissionais e times.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  nativeButton={false}
                  render={<Link href="/get-started" />}
                  size="lg"
                >
                  Começar grátis
                </Button>
                <Button
                  nativeButton={false}
                  render={<Link href="/pricing" />}
                  size="lg"
                  variant="outline"
                >
                  Ver preços
                </Button>
              </div>
              <p className="type-caption text-muted-foreground">
                Telegram · WhatsApp · Sem cartão no Free · {companionPublicHost}
              </p>
            </div>
            <ChatPreview />
          </MarketingFrame>
        </section>

        <section
          aria-labelledby="channels-heading"
          className="border-y border-border/50 bg-muted/25"
        >
          <MarketingFrame className="flex flex-col gap-10 py-16 sm:py-20">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2
                className="type-signal text-3xl tracking-tight sm:text-4xl"
                id="channels-heading"
              >
                Encaixa no seu dia (1), não o contrário
              </h2>
              <p className="type-body text-muted-foreground">
                Integra os messengers que você já usa, com um assistente que
                trata o trabalho como um contato — não como mais um dashboard.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {channels.map((item) => (
                <Card key={item.title}>
                  <CardHeader>
                    <item.icon
                      aria-hidden="true"
                      className="size-5 text-primary"
                    />
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription>{item.body}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </MarketingFrame>
        </section>

        <section aria-labelledby="fit-heading">
          <MarketingFrame className="flex flex-col gap-10 py-16 sm:py-24">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2
                className="type-signal text-3xl tracking-tight sm:text-4xl"
                id="fit-heading"
              >
                O que ele faz no trabalho
              </h2>
              <p className="type-body text-muted-foreground">
                Você manda o que precisa ser resolvido. O Companion segue até o
                fim — e pergunta antes do que é sensível.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {fit.map((item, index) => (
                <Card key={item.title}>
                  <CardHeader>
                    <p className="type-caption text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <CardTitle className="type-section-title">
                      {item.title}
                    </CardTitle>
                    <CardDescription>{item.body}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </MarketingFrame>
        </section>

        <section
          aria-labelledby="audience-heading"
          className="border-y border-border/50 bg-muted/25"
        >
          <MarketingFrame className="flex flex-col gap-10 py-16 sm:py-20">
            <h2
              className="type-signal text-3xl tracking-tight sm:text-4xl"
              id="audience-heading"
            >
              Pessoas, profissionais e times
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {audiences.map((item) => (
                <Card key={item.title}>
                  <CardHeader>
                    <item.icon
                      aria-hidden="true"
                      className="size-5 text-primary"
                    />
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription>{item.body}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </MarketingFrame>
        </section>

        <section aria-labelledby="how-heading">
          <MarketingFrame className="flex flex-col gap-10 py-16 sm:py-24">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2
                className="type-signal text-3xl tracking-tight sm:text-4xl"
                id="how-heading"
              >
                Do zero à primeira resposta útil
              </h2>
              <p className="type-body text-muted-foreground">
                Cadastro → vincular WhatsApp ou Telegram → primeira resposta.
                Caminho do Companion hospedado — não um guia de operação.
              </p>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <Card className="h-full">
                    <CardHeader>
                      <p className="type-signal text-3xl text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </p>
                      <CardTitle>{step.title}</CardTitle>
                      <CardDescription>{step.body}</CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ol>
            <div>
              <Button
                nativeButton={false}
                render={<Link href="/docs" />}
                variant="outline"
              >
                Ler o guia de primeiros passos
              </Button>
            </div>
          </MarketingFrame>
        </section>

        <section
          aria-labelledby="trust-heading"
          className="border-y border-border/50 bg-muted/25"
        >
          <MarketingFrame className="flex flex-col gap-10 py-16 sm:py-20">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2
                className="type-signal text-3xl tracking-tight sm:text-4xl"
                id="trust-heading"
              >
                Confiança, sem overclaim
              </h2>
              <p className="type-body text-muted-foreground">
                Privacidade e cobrança batem com o que a Conta faz hoje.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {trust.map((item) => (
                <Card key={item.title}>
                  <CardHeader>
                    <item.icon
                      aria-hidden="true"
                      className="size-5 text-primary"
                    />
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription>{item.body}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </MarketingFrame>
        </section>

        <section aria-labelledby="pricing-teaser-heading">
          <MarketingFrame className="flex flex-col gap-10 py-16 sm:py-24">
            <div className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
              <h2
                className="type-signal text-3xl tracking-tight sm:text-4xl"
                id="pricing-teaser-heading"
              >
                Escolha um plano para começar
              </h2>
              <p className="type-body text-muted-foreground">
                Todo plano traz o Companion. Comece grátis; suba de cota ou de
                time quando fizer parte do dia.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {marketingPlanOrder.map((plan) => {
                const amount =
                  billingPlanCatalog[plan.id].placeholderPriceUsdMonthly;
                return (
                  <Card
                    className={
                      plan.id === "pro" ? "ring-1 ring-primary/25" : undefined
                    }
                    key={plan.id}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle>{plan.name}</CardTitle>
                        {plan.id === "pro" ? (
                          <Badge variant="information">Popular</Badge>
                        ) : null}
                      </div>
                      <CardDescription>{plan.tagline}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <p>
                        <span className="type-signal text-3xl tracking-tight">
                          {marketingPriceLabel(plan.id, amount)}
                        </span>
                        {plan.priceSuffix ? (
                          <span className="type-caption text-muted-foreground">
                            {" "}
                            {plan.priceSuffix}
                          </span>
                        ) : null}
                      </p>
                      <ul className="flex flex-col gap-2">
                        {plan.features.slice(0, 3).map((feature) => (
                          <li
                            className="type-caption text-muted-foreground"
                            key={feature}
                          >
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                nativeButton={false}
                render={<Link href="/get-started" />}
              >
                Começar grátis
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/pricing" />}
                variant="outline"
              >
                Preços completos
              </Button>
            </div>
          </MarketingFrame>
        </section>

        <section className="border-t border-border/50 bg-muted/25">
          <MarketingFrame className="flex flex-col items-center gap-5 py-16 text-center sm:py-20">
            <h2 className="type-signal max-w-xl text-3xl tracking-tight sm:text-4xl">
              Pronto para o primeiro chat?
            </h2>
            <p className="type-body max-w-lg text-muted-foreground">
              Comece em{" "}
              <a
                className="underline-offset-4 hover:text-foreground hover:underline"
                href={companionPublicOrigin}
              >
                {companionPublicHost}
              </a>
              . Sem cartão no Free.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/get-started" />}
              size="lg"
            >
              Começar grátis
            </Button>
          </MarketingFrame>
        </section>
      </main>
    </MarketingShell>
  );
}
