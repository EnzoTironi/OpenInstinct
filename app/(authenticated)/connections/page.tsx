import { Effect, Result } from "effect";
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ContactRoundIcon,
  MailIcon,
} from "lucide-react";
import Link from "next/link";
import { requireRequestScope } from "@web/auth/request-scope";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { serverRuntime } from "../../../server/runtime";
import { readGoogleWorkspaceConnection } from "../../../server/google-workspace";
import { Alert, AlertTitle, AlertDescription } from "@web/components/ui/alert";
import { GoogleWorkspaceAction } from "./google-workspace-action";
import { LinkedMessengers } from "./_components/linked-messengers";
import { PanelIntro } from "../_components/panel-intro";
import styles from "../_components/panel.module.css";

const googleTools = [
  { label: "Gmail", icon: MailIcon },
  { label: "Agenda", icon: CalendarDaysIcon },
  { label: "Contatos", icon: ContactRoundIcon },
];

export default async function ConnectionsPage({
  searchParams,
}: PageProps<"/connections">) {
  const params = await searchParams;
  const returnTo = googleWorkspaceReturnTo(params.returnTo);
  const connection = await serverRuntime.runPromise(
    readGoogleWorkspaceConnection(await requireRequestScope()).pipe(
      Effect.result
    )
  );
  return (
    <div className={styles.page}>
      <PanelIntro
        image="/marketing/panel/zoen-together.jpg"
        title="Tudo junto. Tudo flui."
        description="Seu e-mail, agenda e contatos. Agora, com o Zoen."
      />
      <div className={styles.serviceIcons}>
        {googleTools.map(({ label, icon: Icon }) => (
          <span key={label}>
            <Icon aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      {Result.isFailure(connection) ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar suas conexões</AlertTitle>
          <AlertDescription>
            Atualize a página para tentar novamente.
          </AlertDescription>
        </Alert>
      ) : connection.success.state === "connected" ? (
        <>
          <p className={styles.statusLine}>
            <CheckIcon aria-hidden="true" />
            Google conectado
          </p>
          <details className={styles.disclosure}>
            <summary>
              Gerenciar conexão
              <ChevronDownIcon aria-hidden="true" />
            </summary>
            <div className={styles.actions}>
              <p className="type-supporting-body text-muted-foreground">
                Ao desconectar, o Zoen deixa de acessar seu Gmail, agenda e
                contatos.
              </p>
              <GoogleWorkspaceAction
                state={connection.success.state}
                returnTo={returnTo}
              />
            </div>
          </details>
        </>
      ) : (
        <div className={styles.actions}>
          <GoogleWorkspaceAction
            state={connection.success.state}
            returnTo={returnTo}
          />
        </div>
      )}
      <details className={styles.disclosure} open={params.messengers === "1"}>
        <summary>
          Mensageiros
          <ChevronDownIcon aria-hidden="true" />
        </summary>
        <div>
          <LinkedMessengers />
        </div>
      </details>
      {returnTo !== "/" && (
        <Link className={styles.subtleLink} href={returnTo}>
          Voltar para a conversa
        </Link>
      )}
    </div>
  );
}
