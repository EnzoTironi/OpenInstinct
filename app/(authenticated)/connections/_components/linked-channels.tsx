"use client";

import { useI18n } from "@web/i18n/context";

import { useState } from "react";
import { authClient } from "@web/auth/client";
import { api } from "@web/trpc/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { ConnectionIcon } from "./connection-icon";
import styles from "../connections.module.css";

interface LinkedChannelIdentity {
  readonly id: string;
  readonly channel: "telegram" | "kapso";
  readonly senderId: string;
}

export function LinkedChannels({
  identities,
}: {
  readonly identities: readonly LinkedChannelIdentity[];
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string>();
  const [lastAccess, setLastAccess] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const selectedIdentity = identities.find(
    (identity) => identity.id === selected
  );
  const revoke = api.accountChannels.revoke.useMutation({
    onSuccess(result) {
      if (result.status === "last_access") {
        setLastAccess(true);
        return;
      }
      setSigningOut(true);
      void authClient.signOut().finally(() => {
        window.location.assign("/sign-in?reason=channel-unlinked");
      });
    },
  });
  return (
    <div className="space-y-3">
      {signingOut ? (
        <Alert>
          <AlertDescription>
            {t("Mensageiro desconectado. Saindo da conta…")}
          </AlertDescription>
        </Alert>
      ) : null}
      {identities.length > 0 && (
        <ul className={styles.list}>
          {identities.map((identity) => (
            <li key={identity.id}>
              <LinkedChannelRow
                identity={identity}
                expanded={selected === identity.id}
                busy={revoke.isPending || signingOut}
                onClick={() => {
                  revoke.reset();
                  setLastAccess(false);
                  setSelected(
                    selected === identity.id ? undefined : identity.id
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {(selectedIdentity && identities.length === 1) || lastAccess ? (
        <Alert>
          <AlertDescription>
            {t(
              "Este é seu único mensageiro para entrar na conta. Conecte outro antes de desconectá-lo."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {selectedIdentity && identities.length > 1 ? (
        <section
          className="space-y-3 rounded-xl border p-4"
          aria-label={t("Confirmar desconexão do mensageiro")}
        >
          <p className="type-supporting-body">
            {t(
              "Desconectar {channel} ({account})? Você sairá da conta em todos os navegadores. Use outro mensageiro conectado para entrar novamente.",
              {
                channel:
                  selectedIdentity.channel === "telegram"
                    ? "Telegram"
                    : "WhatsApp",
                account: selectedIdentity.senderId,
              }
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending || signingOut || lastAccess}
              onClick={() => {
                revoke.mutate({ identityId: selectedIdentity.id });
              }}
            >
              {revoke.isPending ? t("Desconectando…") : t("Desconectar e sair")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={revoke.isPending || signingOut}
              onClick={() => {
                setSelected(undefined);
                setLastAccess(false);
                revoke.reset();
              }}
            >
              {t("Cancelar")}
            </Button>
          </div>
        </section>
      ) : null}
      {revoke.error ? (
        <Alert variant="destructive">
          <AlertDescription>{t(revoke.error.message)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function LinkedChannelRow({
  identity,
  expanded,
  busy,
  onClick,
}: {
  readonly identity: LinkedChannelIdentity;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={styles.row}
      type="button"
      disabled={busy}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <ConnectionIcon provider={identity.channel} />
      <span className={styles.copy}>
        <span>{identity.channel === "telegram" ? "Telegram" : "WhatsApp"}</span>
        <small>{identity.senderId}</small>
      </span>
      {expanded ? (
        <ChevronRightIcon className={styles.trailing} aria-hidden="true" />
      ) : (
        <CheckIcon className={styles.trailing} aria-hidden="true" />
      )}
    </button>
  );
}
