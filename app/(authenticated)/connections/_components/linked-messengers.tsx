import { Effect, Result } from "effect";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { serverRuntime } from "../../../../server/runtime";
import { readLinkedChannelIdentities } from "../../../../server/accounts/controls";
import { LinkedChannels } from "./linked-channels";
import styles from "../../_components/panel.module.css";

export async function LinkedMessengers() {
  const result = await serverRuntime.runPromise(
    readLinkedChannelIdentities(await headers()).pipe(Effect.result)
  );
  if (Result.isFailure(result) && result.failure.reason === "unauthenticated")
    redirect("/sign-in?callbackUrl=%2Fconnections%3Fmessengers%3D1");
  return (
    <>
      {Result.isFailure(result) ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar seus mensageiros</AlertTitle>
          <AlertDescription>
            Atualize a página e tente novamente.
          </AlertDescription>
        </Alert>
      ) : (
        <LinkedChannels identities={result.success} />
      )}
      <details className={styles.disclosure}>
        <summary>
          Conectar um mensageiro
          <ChevronDownIcon aria-hidden="true" />
        </summary>
        <div>
          <ChannelAuthForm
            purpose="link"
            callbackUrl="/connections?messengers=1"
          />
        </div>
      </details>
    </>
  );
}
