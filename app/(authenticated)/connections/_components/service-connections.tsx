"use client";

import Link from "next/link";
import { PlugIcon, ChevronRightIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import styles from "../../_components/connections.module.css";

export function ServiceConnections() {
  const { t } = useI18n();
  const connections = api.workspaces.tools.connections.list.useQuery();
  return (
    <section className={styles.group} aria-label={t("Serviços conectados")}>
      <h2 className={styles.label}>{t("Serviços conectados")}</h2>
      <div className={styles.list}>
        {connections.data?.map((connection) => (
          <Link key={connection.id} className={styles.row} href="/space">
            <PlugIcon aria-hidden="true" />
            <span className={styles.copy}>{connection.name}</span>
            <ChevronRightIcon className={styles.trailing} aria-hidden="true" />
          </Link>
        ))}
        <Link className={styles.row} href="/space">
          <PlugIcon aria-hidden="true" />
          <span className={styles.copy}>
            {t("Gerenciar serviços e ferramentas")}
          </span>
          <ChevronRightIcon className={styles.trailing} aria-hidden="true" />
        </Link>
      </div>
      {connections.error && (
        <p role="alert">{t("Não foi possível atualizar as conexões.")}</p>
      )}
    </section>
  );
}
