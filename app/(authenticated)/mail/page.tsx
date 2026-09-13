import { Effect, Result } from "effect";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { requireRequestScope } from "@web/auth/request-scope";
import { Button } from "@web/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@web/components/ui/alert";
import { serverRuntime } from "../../../server/runtime";
import { readGoogleWorkspaceConnection } from "../../../server/google-workspace";
import { PanelIntro } from "../_components/panel-intro";
import styles from "../_components/panel.module.css";

export default async function MailPage() {
  const connection = await serverRuntime.runPromise(
    readGoogleWorkspaceConnection(await requireRequestScope()).pipe(
      Effect.result
    )
  );
  const connected =
    Result.isSuccess(connection) && connection.success.state === "connected";
  return (
    <div className={styles.page}>
      <PanelIntro
        image="/marketing/panel/zoen-mail.jpg"
        title="Menos e-mail. Mais vida."
        description="Resumos e respostas, em uma conversa."
      />
      {Result.isFailure(connection) ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível verificar seu Gmail</AlertTitle>
          <AlertDescription>
            Tente novamente em{" "}
            <Link href="/connections" className="underline">
              Conexões
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
            {connected ? "Organizar meus e-mails" : "Conectar meu Gmail"}
          </Button>
          {connected && (
            <>
              <Link
                href="/chat?starter=email-draft"
                className={styles.subtleLink}
              >
                Preparar uma resposta
              </Link>
              <Link href="/connections" className={styles.statusLine}>
                <CheckIcon aria-hidden="true" />
                Gmail conectado
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
