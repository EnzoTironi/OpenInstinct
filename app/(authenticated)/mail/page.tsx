import { getI18n } from "@web/i18n/server";
import { headers } from "next/headers";
import { Effect, Result } from "effect";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { requireRequestScope } from "@web/auth/request-scope";
import { Button } from "@web/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@web/components/ui/alert";
import { serverRuntime } from "../../../server/runtime";
import { readPersonalGoogleSettings } from "../../../server/google-workspace/settings";
import { resolveWorkspaceActor } from "../../../server/workspaces/session";
import { PanelIntro } from "../_components/panel-intro";
import styles from "../_components/panel.module.css";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { PanelLink } from "../_components/panel-link";

export default async function MailPage() {
  const { t } = await getI18n();
  const scope = await requireRequestScope();
  if (scope.workspaceId !== accessScopeForUser(scope.userId).workspaceId)
    return (
      <div className={styles.page}>
        <PanelIntro
          image="/marketing/panel/zoen-mail.jpg"
          title={t("Cada coisa no seu espaço.")}
          description={t(
            "Seu Gmail pessoal continua no espaço pessoal. Você pode preparar textos com os arquivos da equipe."
          )}
        />
        <div className={styles.actions}>
          <Button nativeButton={false} render={<PanelLink href="/chat" />}>
            {t("Abrir conversa")}
          </Button>
        </div>
      </div>
    );
  const connection = await serverRuntime.runPromise(
    resolveWorkspaceActor(await headers()).pipe(
      Effect.flatMap(readPersonalGoogleSettings),
      Effect.result
    )
  );
  const connected =
    Result.isSuccess(connection) && connection.success.state === "connected";
  return (
    <div className={styles.page}>
      <PanelIntro
        image="/marketing/panel/zoen-mail.jpg"
        title={t("Menos e-mail. Mais vida.")}
        description={t("Resumos e respostas, em uma conversa.")}
      />
      {Result.isFailure(connection) ? (
        <Alert variant="destructive">
          <AlertTitle>{t("Não foi possível verificar seu Gmail")}</AlertTitle>
          <AlertDescription>
            {t("Tente novamente em")}{" "}
            <Link href="/connections" className="underline">
              {t("Conexões")}
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <div className={styles.actions}>
          <Button
            nativeButton={false}
            render={
              <Link href={connected ? "/chat?starter=email" : "/connections"} />
            }
          >
            {connected ? t("Organizar meus e-mails") : t("Conectar meu Gmail")}
          </Button>
          {connected && (
            <>
              <Link
                href="/chat?starter=email-draft"
                className={styles.subtleLink}
              >
                {t("Preparar uma resposta")}
              </Link>
              <Link href="/connections" className={styles.statusLine}>
                <CheckIcon aria-hidden="true" />
                {t("Gmail conectado")}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
