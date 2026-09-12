import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";
import { Button } from "@web/components/ui/button";
import { Logo } from "@web/components/ui/logo";

export function GetStartedPanel({
  whatsappUrl,
  telegramUrl,
  imessageUrl,
}: {
  readonly whatsappUrl: string | null;
  readonly telegramUrl: string | null;
  readonly imessageUrl: string | null;
}) {
  const available = Boolean(whatsappUrl ?? telegramUrl ?? imessageUrl);
  return (
    <section className="w-full max-w-md space-y-8 text-center">
      <Link
        className="inline-flex items-center gap-2 type-label"
        href="/welcome"
      >
        <Logo /> Zoen
      </Link>
      <header className="space-y-3">
        <h1 className="type-page-title">Tudo começa com um oi.</h1>
        <p className="type-supporting-body text-muted-foreground">
          {available
            ? "Abra a conversa e faça seu primeiro pedido. Seu Zoen começa com você."
            : "A conversa ainda não está disponível por aqui. Volte em breve para conhecer seu Zoen."}
        </p>
      </header>
      {available ? (
        <div className="flex flex-col gap-3">
          {[
            { label: "WhatsApp", url: whatsappUrl },
            { label: "Telegram", url: telegramUrl },
            { label: "iMessage", url: imessageUrl },
          ].map(
            ({ label, url }) =>
              url && (
                <Button
                  key={label}
                  nativeButton={false}
                  render={<a aria-label={`Abrir ${label}`} href={url} />}
                  size="lg"
                >
                  <MessageCircleIcon aria-hidden="true" /> Abrir {label}
                </Button>
              )
          )}
        </div>
      ) : (
        <Button
          nativeButton={false}
          render={<Link href="/welcome" />}
          size="lg"
        >
          Conhecer o Zoen
        </Button>
      )}
      <p className="type-caption text-muted-foreground">
        Já usa o Zoen?{" "}
        <Link className="underline underline-offset-4" href="/sign-in">
          Acessar minha conta
        </Link>
      </p>
    </section>
  );
}
