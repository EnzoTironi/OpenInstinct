"use client";

import { useState, type ComponentProps } from "react";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { useI18n } from "@web/i18n/context";
import { GoogleWorkspaceAction } from "../google-workspace-action";
import { LinkedChannels } from "./linked-channels";
import { ConnectionIcon } from "./connection-icon";
import styles from "../connections.module.css";

export function ConnectionList({
  googleState,
  identities,
  returnTo,
}: {
  readonly googleState: ComponentProps<typeof GoogleWorkspaceAction>["state"];
  readonly identities: ComponentProps<typeof LinkedChannels>["identities"];
  readonly returnTo: string;
}) {
  const { t } = useI18n();
  const [manageGoogle, setManageGoogle] = useState(false);
  const connectedGoogle = googleState === "connected";
  const availableChannels = (["telegram", "kapso"] as const).filter(
    (channel) => !identities.some((identity) => identity.channel === channel)
  );
  return (
    <>
      <section className={styles.group} aria-label={t("Conectadas")}>
        <h2 className={styles.label}>{t("Conectadas")}</h2>
        <div className={styles.list}>
          {connectedGoogle && (
            <div>
              <button
                className={styles.row}
                type="button"
                onClick={() => {
                  setManageGoogle(!manageGoogle);
                }}
                aria-expanded={manageGoogle}
              >
                <ConnectionIcon provider="google" />
                <span className={styles.copy}>
                  <span>Google</span>
                  <small>{t("Gmail, Agenda e Contatos")}</small>
                </span>
                <CheckIcon className={styles.trailing} aria-hidden="true" />
              </button>
              {manageGoogle && (
                <div className={styles.manage}>
                  <p className="type-caption text-muted-foreground">
                    {t(
                      "Ao desconectar, o Zoen deixa de acessar seu Gmail, agenda e contatos."
                    )}
                  </p>
                  <GoogleWorkspaceAction
                    state={googleState}
                    returnTo={returnTo}
                  />
                </div>
              )}
            </div>
          )}
          <LinkedChannels identities={identities} />
        </div>
        {!connectedGoogle && identities.length === 0 && (
          <p className={styles.empty}>
            {t("Suas conexões vão aparecer aqui.")}
          </p>
        )}
      </section>
      {(!connectedGoogle || availableChannels.length > 0) && (
        <section className={styles.group} aria-label={t("Adicionar conexão")}>
          <h2 className={styles.label}>{t("Adicionar conexão")}</h2>
          <div className={styles.list}>
            {!connectedGoogle && (
              <GoogleWorkspaceAction
                state={googleState}
                returnTo={returnTo}
                className={styles.row}
              >
                <ConnectionIcon provider="google" />
                <span className={styles.copy}>
                  <span>Google</span>
                  <small>
                    {googleState === "unavailable"
                      ? t("Em preparação")
                      : t("Gmail, Agenda e Contatos")}
                  </small>
                </span>
                <PlusIcon className={styles.trailing} aria-hidden="true" />
              </GoogleWorkspaceAction>
            )}
            {availableChannels.length > 0 && (
              <ChannelAuthForm purpose="link" callbackUrl="/connections">
                {({ start, busy }) => (
                  <div className={styles.list}>
                    {availableChannels.map((channel) => (
                      <button
                        key={channel}
                        type="button"
                        className={styles.row}
                        disabled={busy}
                        onClick={() => {
                          start(channel);
                        }}
                      >
                        <ConnectionIcon provider={channel} />
                        <span className={styles.copy}>
                          {channel === "telegram" ? "Telegram" : "WhatsApp"}
                        </span>
                        <ChevronRightIcon
                          className={styles.trailing}
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </ChannelAuthForm>
            )}
          </div>
        </section>
      )}
    </>
  );
}
