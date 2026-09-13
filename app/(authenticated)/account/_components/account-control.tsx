"use client";

import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { reauthenticationDestination } from "@web/auth/channel/client";
import { authClient } from "@web/auth/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";

export function AuthenticatedAccountControl() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        aria-label="Sair da conta"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void Promise.allSettled([authClient.signOut()]).then(([outcome]) => {
            const destination = reauthenticationDestination(outcome, "/");
            if (destination) {
              window.location.assign(destination);
              return undefined;
            }
            setFailed(true);
            setBusy(false);
            return undefined;
          });
        }}
        variant="ghost"
      >
        <LogOutIcon />
        {busy ? "Saindo…" : "Sair da conta"}
      </Button>
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>
            Não foi possível sair. Verifique a conexão e tente novamente.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
