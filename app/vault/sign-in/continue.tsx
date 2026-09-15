"use client";

import { useState, useTransition } from "react";
import { Effect } from "effect";
import { ShieldCheckIcon } from "lucide-react";
import { authClient } from "@web/auth/client";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@web/i18n/context";

export function VaultContinue() {
  const { t } = useI18n();
  const [busy, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid gap-5 p-6 text-center">
      <ShieldCheckIcon className="mx-auto size-10" />
      <h1 className="type-page-title">{t("Seu cofre.")}</h1>
      <p className="type-supporting-body text-muted-foreground">
        {t(
          "Sua conta Zoen abre a porta. Só sua senha mestra desbloqueia o cofre."
        )}
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          start(async () => {
            setFailed(false);
            await Effect.runPromise(
              Effect.tryPromise(() =>
                authClient.oauth2.consent({ accept: true })
              ).pipe(
                Effect.match({
                  onFailure: () => {
                    setFailed(true);
                  },
                  onSuccess: (result) => {
                    if (result.error || !result.data.url) setFailed(true);
                    else window.location.assign(result.data.url);
                  },
                })
              )
            );
          });
        }}
      >
        {t("Continuar no cofre")}
      </Button>
      {failed ? (
        <p role="alert" className="type-caption text-destructive">
          {t("Abra o cofre pelo Zoen e tente novamente.")}
        </p>
      ) : null}
    </div>
  );
}
