"use client";

import { useState } from "react";
import {
  CheckIcon,
  PlusIcon,
  PuzzleIcon,
  MessagesSquareIcon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { ConnectionIcon } from "./connection-icon";
import { PanelLink } from "../../_components/panel-link";
import styles from "../../_components/connections.module.css";

export function TeamConnections() {
  const { t } = useI18n();
  const state = api.workspaces.connections.list.useQuery();
  const share = api.workspaces.connections.shareGoogle.useMutation();
  const disconnect = api.workspaces.connections.disconnectGoogle.useMutation();
  const [expanded, setExpanded] = useState(false);
  const google = state.data?.connections[0];
  return (
    <>
      <PanelLink className={styles.row} href="/space/rooms">
        <MessagesSquareIcon />
        <span className={styles.copy}>
          <span>Matrix</span>
          <small>{t("Salas da equipe")}</small>
        </span>
      </PanelLink>
      <section className={styles.group}>
        <h2 className={styles.label}>{t("Conectadas")}</h2>
        <div className={styles.list}>
          {google && (
            <button
              className={styles.row}
              type="button"
              onClick={() => {
                setExpanded(!expanded);
              }}
              aria-expanded={expanded}
            >
              <ConnectionIcon provider="google" />
              <span className={styles.copy}>
                <span>Google</span>
                <small>{google.label}</small>
              </span>
              <CheckIcon className={styles.trailing} />
            </button>
          )}
        </div>
        {!google && (
          <p className={styles.empty}>
            {t("Suas conexões vão aparecer aqui.")}
          </p>
        )}
      </section>
      {!google && (
        <section className={styles.group}>
          <h2 className={styles.label}>{t("Adicionar conexão")}</h2>
          <button
            className={styles.row}
            type="button"
            disabled={!state.data?.mayManage}
            onClick={() => {
              setExpanded(!expanded);
            }}
            aria-expanded={expanded}
          >
            <ConnectionIcon provider="google" />
            <span className={styles.copy}>
              <span>Google</span>
              <small>{t("Gmail, Agenda e Contatos")}</small>
            </span>
            <PlusIcon className={styles.trailing} />
          </button>
        </section>
      )}
      {expanded && state.data?.mayManage && (
        <div className={styles.manage}>
          <p>
            {t(
              google
                ? "Ao desconectar, a equipe perde acesso a esta conexão."
                : "Sua conta Google conectada ficará disponível para os membros deste espaço. Confirme que esta é a conta que deseja compartilhar."
            )}
          </p>
          <Button
            disabled={share.isPending || disconnect.isPending}
            onClick={() => {
              void (google ? disconnect.mutateAsync() : share.mutateAsync())
                .then(() => state.refetch())
                .catch(() => undefined);
            }}
          >
            {t(
              google
                ? "Desconectar da equipe"
                : "Compartilhar Google com a equipe"
            )}
          </Button>
        </div>
      )}
      {(state.error ?? share.error ?? disconnect.error) && (
        <p role="alert">
          {t(
            "Não foi possível conectar. Conecte o Google no seu espaço pessoal e tente novamente."
          )}
        </p>
      )}
      <PanelLink className={styles.row} href="/space?tab=plugins">
        <PuzzleIcon />
        <span>{t("Permissões das ferramentas")}</span>
      </PanelLink>
    </>
  );
}
