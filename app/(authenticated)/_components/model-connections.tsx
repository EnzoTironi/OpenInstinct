"use client";

import { useState } from "react";
import { CheckIcon, ChevronRightIcon, CpuIcon } from "lucide-react";
import { Schema } from "effect";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { ModelAuthorization } from "./model-authorization";
import { modelCatalog, WorkspaceModelSchema } from "@shared/models/catalog";
import styles from "./connections.module.css";

export function ModelConnections() {
  const { t } = useI18n();
  const state = api.modelConnections.read.useQuery();
  const select = api.modelConnections.select.useMutation();
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const connection = state.data?.connection;
  const connected = Boolean(connection?.connected);
  const { refetch } = state;

  return (
    <section className={styles.group}>
      <h2 className={styles.label}>{t("Inteligência")}</h2>
      <button
        type="button"
        className={styles.row}
        onClick={() => {
          setExpanded(!expanded);
        }}
        aria-expanded={expanded}
      >
        <CpuIcon aria-hidden="true" />
        <span className={styles.copy}>
          <span>
            {connected
              ? connection?.provider === "chatgpt"
                ? "ChatGPT"
                : "Grok"
              : "Zoen"}
          </span>
          <small>
            {connected && connection
              ? modelCatalog[connection.model].label
              : t("Usar sua própria conta")}
          </small>
        </span>
        {connected ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <ChevronRightIcon aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className={styles.manage}>
          <p className="type-caption text-muted-foreground">
            {t(
              state.data?.team
                ? "A conta conectada será usada pelos membros deste espaço."
                : "Use os modelos da sua conta, mantendo suas conversas no Zoen."
            )}
          </p>
          {state.data?.mayManage && (
            <>
              {connected && connection && (
                <label className="flex flex-col gap-2 type-label">
                  {t("Modelo")}
                  <select
                    className="rounded-xl border border-input bg-background p-3"
                    value={connection.model}
                    disabled={select.isPending}
                    onChange={(event) => {
                      const model = event.target.value;
                      if (Schema.is(WorkspaceModelSchema)(model))
                        void select
                          .mutateAsync({ model })
                          .then(() => refetch())
                          .catch(() => {
                            setFailed(true);
                          });
                    }}
                  >
                    {Object.entries(modelCatalog)
                      .filter(
                        ([, value]) => value.provider === connection.provider
                      )
                      .map(([model, value]) => (
                        <option key={model} value={model}>
                          {value.label}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <ModelAuthorization connected={connected} />
            </>
          )}
          {(failed || state.error) && (
            <p className="mt-3 type-caption" role="alert">
              {t(
                "Não foi possível conectar. Verifique o acesso aos modelos na sua conta e tente novamente."
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
