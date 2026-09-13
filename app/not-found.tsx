import Link from "next/link";
import { getI18n } from "@web/i18n/server";
import { Logo } from "@web/components/ui/logo";
import { Button } from "@web/components/ui/button";

export default async function WorkspaceNotFound() {
  const { t } = await getI18n();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <Logo />
      <h1 className="type-section-title">
        {t("Este espaço não está disponível.")}
      </h1>
      <p className="type-supporting-body text-muted-foreground">
        {t("O acesso pode ter mudado. Seu espaço pessoal continua aqui.")}
      </p>
      <Button nativeButton={false} render={<Link href="/" />}>
        {t("Voltar ao meu espaço")}
      </Button>
    </main>
  );
}
