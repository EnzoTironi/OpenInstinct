"use client";

import { useI18n } from "@web/i18n/context";

import { Badge } from "@web/components/ui/badge";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { api } from "@web/trpc/client";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";

export function GoogleWorkspaceAction({
  state,
  returnTo,
  children,
  className,
}: {
  readonly state?: "connected" | "paused" | "disconnected" | "unavailable";
  readonly returnTo?: string;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const returnPath = googleWorkspaceReturnTo(returnTo);
  const update = api.googleWorkspace.update.useMutation({
    onError: () => {
      setFailed(true);
    },
    onSuccess: ({ redirectTo, authorize }) => {
      if (authorize) window.location.assign(redirectTo);
      else router.refresh();
    },
  });

  if (!state && !children) {
    return <Badge variant="secondary">{t("Carregando…")}</Badge>;
  }
  if (state === "unavailable" && !children) {
    return <Badge variant="secondary">{t("Em preparação")}</Badge>;
  }

  const action = state === "connected" ? "disconnect" : "connect";
  return (
    <>
      <Button
        className={className}
        disabled={update.isPending || state === "unavailable" || !state}
        onClick={() => {
          setFailed(false);
          update.mutate({ action, returnTo: returnPath });
        }}
        size={children ? "none" : "default"}
        type="button"
        variant={state === "connected" ? "outline" : "default"}
      >
        {children ??
          (state === "connected"
            ? t("Desconectar Google")
            : state === "paused"
              ? t("Ativar Google")
              : t("Conectar Google"))}
      </Button>
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>
            {t("Não foi possível atualizar a conexão com o Google.")}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
