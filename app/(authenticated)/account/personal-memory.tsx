import { getI18n } from "@web/i18n/server";
import { Effect, Result } from "effect";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { inspectPersonalMemory } from "../../../server/personal-memory/export";
import { serverRuntime } from "../../../server/runtime";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { buttonVariants } from "@web/components/ui/button";

async function MemoryUnavailable() {
  const { t } = await getI18n();
  return (
    <Alert variant="destructive">
      <AlertTitle>{t("Não foi possível carregar a memória")}</AlertTitle>
      <AlertDescription>
        {t("Atualize a página para tentar novamente.")}
      </AlertDescription>
    </Alert>
  );
}

export async function PersonalMemorySection() {
  const { t } = await getI18n();
  let result;
  try {
    result = await serverRuntime.runPromise(
      inspectPersonalMemory(await headers()).pipe(Effect.result)
    );
  } catch {
    return <MemoryUnavailable />;
  }
  if (Result.isFailure(result)) {
    if (result.failure.reason === "unauthenticated")
      redirect("/sign-in?callbackUrl=%2Faccount");
    return <MemoryUnavailable />;
  }
  const snapshot = result.success;
  const profile = Object.entries(snapshot.profile).filter(
    ([, value]) => value !== null
  );
  return (
    <section
      aria-labelledby="personal-memory-heading"
      className="space-y-4 rounded-xl border p-4 sm:p-6"
    >
      <div className="space-y-2">
        <h2 id="personal-memory-heading" className="type-section-title">
          {t("O que o Zoen lembra")}
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          {t(
            "Seu perfil e as notas salvas pelo Zoen. A exportação desta memória inclui esses registros. Conversas, arquivos, conexões e agendamentos ficam fora deste arquivo."
          )}
        </p>
      </div>
      <h3 className="type-supporting-body font-medium">
        {t("Seu perfil salvo")}
      </h3>
      {profile.length ? (
        <dl className="type-supporting-body grid gap-2">
          {profile.map(([field, value]) => (
            <div key={field} className="grid gap-1 sm:grid-cols-2">
              <dt className="text-muted-foreground capitalize">
                {field.replaceAll(/([A-Z])/g, " $1")}
              </dt>
              <dd className="wrap-break-word">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="type-supporting-body text-muted-foreground">
          {t("Nenhum detalhe do perfil salvo ainda.")}
        </p>
      )}
      <Link
        href="/personal-info"
        className={buttonVariants({ variant: "outline" })}
      >
        {t("Editar meus dados")}
      </Link>
      <h3 className="type-supporting-body font-medium">{t("Notas do Zoen")}</h3>
      <p className="type-supporting-body text-muted-foreground">
        {t(
          "Peça ao Zoen para corrigir ou esquecer uma informação na sua conversa privada. Ele pode atualizar seu perfil e suas notas. Conversas anteriores e cópias já baixadas permanecem separadas."
        )}
      </p>
      {snapshot.notes.status === "unresolved" ? (
        <p className="type-supporting-body text-muted-foreground">
          {t(
            "Ainda não foi possível localizar as notas desta conta. Continue uma conversa com o Zoen e atualize esta página."
          )}
        </p>
      ) : snapshot.notes.documents.length ? (
        snapshot.notes.documents.map((document) => (
          <pre
            key={document.version}
            className="type-supporting-body rounded-lg bg-muted p-3 wrap-break-word whitespace-pre-wrap"
          >
            {document.content.replace(/^<!--[^\n]*-->\r?\n/u, "") ||
              t("Nenhuma nota salva neste documento.")}
          </pre>
        ))
      ) : (
        <p className="type-supporting-body text-muted-foreground">
          {t("Nenhuma nota salva nesta memória.")}
        </p>
      )}
      <a
        href="/api/account/personal-memory/export"
        download
        className={buttonVariants({ variant: "outline" })}
      >
        {t("Exportar minha memória (JSON)")}
      </a>
    </section>
  );
}
