import Link from "next/link";
import { Button } from "@web/components/ui/button";
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
import {
  companionPublicHost,
  companionPublicOrigin,
} from "../../public-origin";

const steps = [
  {
    title: "Abra Começar",
    body: `Visite /get-started no Companion hospedado em ${companionPublicHost}.`,
  },
  {
    title: "Escolha Telegram ou WhatsApp",
    body: "Esse messenger cria a conta e o workspace pessoal.",
  },
  {
    title: "Confirme no chat",
    body: "Aprove o pedido do navegador nesse messenger e volte à aba.",
  },
  {
    title: "Chegue na home",
    body: "Você vê o status do canal, os próximos passos e o selo do plano Free pessoal.",
  },
  {
    title: "Fale com o Companion",
    body: "Converse no messenger vinculado ou comece no web. Canais e plano ficam em Conta.",
  },
] as const;

const links = [
  {
    href: "/get-started",
    title: "Começar",
    body: "Crie a conta e vincule um canal num fluxo só.",
  },
  {
    href: "/pricing",
    title: "Preços",
    body: "Free, Pro e assentos Org — Free nunca pede cartão.",
  },
  {
    href: "/sign-in",
    title: "Entrar",
    body: "Quem já vinculou um messenger entra por ele.",
  },
] as const;

export function DocsPanel() {
  return (
    <MarketingShell active="docs">
      <main>
        <MarketingFrame className="flex max-w-3xl flex-col gap-16 py-16 sm:py-24">
          <header className="flex flex-col gap-5">
            <p className="type-caption text-muted-foreground">Guia</p>
            <h1 className="type-signal text-4xl tracking-tight sm:text-5xl lg:leading-[1.05]">
              Primeiros passos — para quem usa, não para quem opera
            </h1>
            <p className="type-body text-lg text-muted-foreground">
              Caminho curto no Companion hospedado em{" "}
              <a
                className="underline-offset-4 hover:text-foreground hover:underline"
                href={companionPublicOrigin}
              >
                {companionPublicHost}
              </a>{" "}
              — não é guia de self-host. Entrada nativa por Telegram ou WhatsApp
              ainda funciona sem o passo web.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                nativeButton={false}
                render={<Link href="/get-started" />}
              >
                Começar agora
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/welcome" />}
                variant="outline"
              >
                Voltar ao produto
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
              Fluxo
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
                        <CardTitle>{step.title}</CardTitle>
                        <CardDescription>{step.body}</CardDescription>
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
              Notas de confiança
            </h2>
            <ul className="type-supporting-body flex flex-col gap-3 text-muted-foreground">
              <li>
                Free nunca pede cartão. Pago usa Stripe Checkout + Portal.
              </li>
              <li>
                Exportar e apagar hoje cobrem só a memória pessoal — não conta
                inteira, histórico, backups nem identidade de canal.
              </li>
              <li>
                Não espere templates proativos no WhatsApp até a aprovação
                UTILITY da Meta.
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
              Relacionados
            </h2>
            <ul className="grid gap-3">
              {links.map((item) => (
                <li key={item.href}>
                  <Link className="block" href={item.href}>
                    <Card className="transition-colors hover:bg-muted/40">
                      <CardHeader>
                        <CardTitle>{item.title}</CardTitle>
                        <CardDescription>{item.body}</CardDescription>
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
