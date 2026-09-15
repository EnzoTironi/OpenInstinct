"use client";

import { BotIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@web/i18n/context";
import { api } from "@web/trpc/client";

export function VaultDelegation({ itemId }: { readonly itemId: string }) {
  const { t, locale } = useI18n();
  const utils = api.useUtils();
  const access = api.workspaces.vault.delegations.useQuery();
  const refresh = () => utils.workspaces.vault.delegations.invalidate();
  const delegate = api.workspaces.vault.delegate.useMutation({
    onSuccess: refresh,
  });
  const revoke = api.workspaces.vault.revoke.useMutation({
    onSuccess: refresh,
  });
  const grant = access.data?.items.find((item) => item.itemId === itemId);
  const busy = delegate.isPending || revoke.isPending;
  const error = access.error ?? delegate.error ?? revoke.error;

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <Button
        disabled={!access.data?.mayManage || busy}
        onClick={() => {
          if (grant) revoke.mutate({ id: grant.id });
          else delegate.mutate({ itemId, days: 7 });
        }}
        size="sm"
        type="button"
        variant="quiet"
      >
        {grant ? <ShieldCheckIcon /> : <BotIcon />}
        {grant ? t("Revogar acesso do Zoen") : t("Permitir ao Zoen por 7 dias")}
      </Button>
      {grant ? (
        <p className="type-caption text-muted-foreground">
          {t("Até {date}", {
            date: new Date(grant.expiresAt).toLocaleDateString(locale),
          })}
        </p>
      ) : null}
      {error ? (
        <p className="type-caption text-destructive" role="alert">
          {t("Não foi possível atualizar o acesso. Tente novamente.")}
        </p>
      ) : null}
    </div>
  );
}
