import Link from "next/link";
import { Effect, Result } from "effect";
import { headers } from "next/headers";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { serverRuntime } from "../../../server/runtime";
import { requireRequestScope } from "@web/auth/request-scope";
import { FirstRunStatus } from "./_components/first-run-status";
import { readLinkedChannelIdentities } from "../../../server/accounts/controls";
import styles from "../_components/home.module.css";

export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const returnTo = googleWorkspaceReturnTo(params.returnTo);
  await requireRequestScope();
  const welcome = params.welcome === "1" || params.welcome === "true";
  const linkedChannels = welcome
    ? await serverRuntime.runPromise(
        readLinkedChannelIdentities(await headers()).pipe(Effect.result)
      )
    : undefined;
  return (
    <>
      {linkedChannels && Result.isFailure(linkedChannels) && (
        <p className={styles.notice} role="alert">
          Não foi possível verificar seus mensageiros.{" "}
          <Link href="/connections">Revisar conexões</Link>.
        </p>
      )}
      {params.google === "unavailable" && (
        <p className={styles.notice} role="alert">
          Não foi possível atualizar a conexão com o Google.{" "}
          <Link href="/connections">Revisar conexão</Link>.
        </p>
      )}
      {returnTo !== "/" && (
        <p className={styles.notice}>
          <Link href={returnTo}>Voltar para sua conversa</Link> ou{" "}
          <Link href={`/connections?returnTo=${encodeURIComponent(returnTo)}`}>
            gerenciar a conexão com o Google
          </Link>
          .
        </p>
      )}
      {linkedChannels && Result.isSuccess(linkedChannels) && (
        <div className={styles.notice}>
          <FirstRunStatus identities={linkedChannels.success} welcome />
        </div>
      )}
    </>
  );
}
