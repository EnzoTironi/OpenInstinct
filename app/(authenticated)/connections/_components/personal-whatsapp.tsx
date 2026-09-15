"use client";

import { useState } from "react";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { ConnectionIcon } from "./connection-icon";
import styles from "../../_components/connections.module.css";

export function PersonalWhatsApp() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const accounts = api.workspaces.whatsapp.list.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.accounts.some((account) => account.status === "pairing")
        ? 2000
        : false,
  });
  const start = api.workspaces.whatsapp.start.useMutation({
    onSuccess: (data) => {
      setQr(data.qr);
      setOpen(true);
      void accounts.refetch();
    },
  });
  const pause = api.workspaces.whatsapp.pause.useMutation({
    onSuccess: () => {
      void accounts.refetch();
    },
  });
  const resume = api.workspaces.whatsapp.resume.useMutation({
    onSuccess: () => {
      void accounts.refetch();
    },
  });
  const revoke = api.workspaces.whatsapp.revoke.useMutation({
    onSuccess: () => {
      void accounts.refetch();
    },
  });
  const account = accounts.data?.accounts[0];
  const busy =
    start.isPending || pause.isPending || resume.isPending || revoke.isPending;
  const connected = account?.status === "connected";
  const paused = account?.status === "paused";
  const pairing = account?.status === "pairing";
  const pairingQr = connected || paused ? null : qr;
  return (
    <section className={styles.group} aria-label={t("Meu WhatsApp")}>
      <h2 className={styles.label}>{t("Meu WhatsApp")}</h2>
      <div className={styles.list}>
        {accounts.isPending ? (
          <p className={styles.empty}>{t("Carregando…")}</p>
        ) : connected || paused || pairing ? (
          <div>
            <button
              className={styles.row}
              type="button"
              onClick={() => {
                setOpen(!open);
              }}
              aria-expanded={open}
            >
              <ConnectionIcon provider="kapso" />
              <span className={styles.copy}>
                <span>{t("Meu WhatsApp")}</span>
                <small>
                  {paused
                    ? t("Pausado · ativar")
                    : pairing
                      ? t("Aguardando o pareamento no telefone.")
                      : t("WhatsApp pessoal conectado")}
                </small>
              </span>
              {open ? (
                <ChevronRightIcon
                  className={styles.trailing}
                  aria-hidden="true"
                />
              ) : (
                <CheckIcon className={styles.trailing} aria-hidden="true" />
              )}
            </button>
            {open && (
              <div className={styles.manage}>
                <p className="type-caption text-muted-foreground">
                  {t("Sua conta pessoal, não o WhatsApp de acesso.")}{" "}
                  {t("Sem telefone pareado, o envio fica na fila.")}
                </p>
                {pairing && pairingQr ? (
                  <figure>
                    {pairingQr.startsWith("data:") ? (
                      // Native img: the bridge may return a data URL instead of a payload string.
                      // oxlint-disable-next-line nextjs/no-img-element
                      <img
                        alt={t("Código de pareamento do WhatsApp")}
                        src={pairingQr}
                        width={192}
                        height={192}
                      />
                    ) : (
                      <pre className="max-w-xs type-caption wrap-break-word whitespace-pre-wrap">
                        {pairingQr}
                      </pre>
                    )}
                    <figcaption className="type-caption text-muted-foreground">
                      {t("Escaneie este código no WhatsApp do telefone.")}
                    </figcaption>
                  </figure>
                ) : null}
                {connected ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      pause.mutate();
                    }}
                  >
                    {t("Pausar WhatsApp pessoal")}
                  </Button>
                ) : null}
                {paused ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      resume.mutate();
                    }}
                  >
                    {t("Retomar WhatsApp pessoal")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    revoke.mutate();
                  }}
                >
                  {t("Desconectar WhatsApp pessoal")}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className={styles.row}
            disabled={busy}
            onClick={() => {
              start.mutate();
            }}
          >
            <ConnectionIcon provider="kapso" />
            <span className={styles.copy}>
              <span>{t("Meu WhatsApp")}</span>
              <small>{t("Parear WhatsApp pessoal")}</small>
            </span>
            <PlusIcon className={styles.trailing} aria-hidden="true" />
          </button>
        )}
      </div>
      {start.error ||
      pause.error ||
      resume.error ||
      revoke.error ||
      accounts.error ? (
        <p role="alert">{t("Não foi possível falar com a ponte.")}</p>
      ) : null}
    </section>
  );
}
