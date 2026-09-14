"use client";

import { useState } from "react";
import {
  ActivityIcon,
  CheckIcon,
  ChevronRightIcon,
  RefreshCwIcon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { DiagnosticSession } from "./session";
import styles from "../_components/panel.module.css";

export function Insights() {
  const { t, locale } = useI18n();
  const [platform, setPlatform] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const state = api.insights.read.useQuery(
    { platform },
    { refetchInterval: 30_000 }
  );
  const configure = api.insights.configure.useMutation();
  const number = new Intl.NumberFormat(locale);
  const totals = state.data?.summary;
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.page} data-private>
      <div className="flex items-center justify-between gap-3">
        <h1 className="type-page-title">{t("Visão geral")}</h1>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("Atualizar")}
          onClick={() => void state.refetch()}
        >
          <RefreshCwIcon size={18} />
        </Button>
      </div>
      <p className="type-caption text-muted-foreground">
        {t("Últimos 7 dias")}
      </p>
      {state.data?.operator && (
        <div className="my-3 flex gap-2">
          <Button
            variant={!platform ? "default" : "ghost"}
            onClick={() => {
              setPlatform(false);
              setSession(null);
            }}
          >
            {t("Este espaço")}
          </Button>
          <Button
            variant={platform ? "default" : "ghost"}
            onClick={() => {
              setPlatform(true);
              setSession(null);
            }}
          >
            {t("Plataforma")}
          </Button>
        </div>
      )}
      <div className="my-5 grid grid-cols-2 gap-3">
        {[
          [
            t("Conversas concluídas"),
            totals ? number.format(totals.turns) : "—",
          ],
          [
            t("Falhas"),
            totals
              ? number.format(
                  totals.failures +
                    totals.tool_failures +
                    totals.client_errors +
                    totals.server_errors
                )
              : "—",
          ],
          [
            t("Tokens"),
            totals
              ? number.format(totals.input_tokens + totals.output_tokens)
              : "—",
          ],
          [
            t("Latência p95"),
            totals?.p95_ms == null
              ? "—"
              : `${(totals.p95_ms / 1000).toFixed(1)} s`,
          ],
        ].map(([label, value]) => (
          <div key={label} className={styles.sectionCard}>
            <p className="type-caption text-muted-foreground">{label}</p>
            <strong className="type-section-title">{value}</strong>
          </div>
        ))}
      </div>
      <p className="type-caption text-muted-foreground">
        {t("Custo informado pelo provedor")}:{" "}
        {totals?.cost_usd == null
          ? t("Não informado")
          : new Intl.NumberFormat(locale, {
              style: "currency",
              currency: "USD",
            }).format(totals.cost_usd)}
      </p>
      {state.data?.mayManage && !platform && (
        <details
          className="my-4"
          open={settings}
          onToggle={(event) => {
            setSettings(event.currentTarget.open);
          }}
        >
          <summary className="cursor-pointer type-label">
            {t("Diagnóstico do espaço")}
          </summary>
          <div className="my-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 type-caption">
              <input
                type="checkbox"
                checked={state.data.policy.captureContent}
                disabled={configure.isPending}
                onChange={(event) => {
                  void configure
                    .mutateAsync({
                      captureContent: event.target.checked,
                      retentionDays: 14,
                    })
                    .then(() => state.refetch())
                    .catch(() => {
                      setFailed(true);
                    });
                }}
              />
              {t("Registrar conteúdo e reprodução da interface")}
            </label>
            <p className="type-caption text-muted-foreground">
              {t("Conteúdo: 14 dias. Métricas: 90 dias.")}
            </p>
          </div>
        </details>
      )}
      <h2 className="type-section-title my-5">{t("Experiências")}</h2>
      <div className={styles.actionList}>
        {state.data?.sessions.map((item) => (
          <button
            key={item.session_id}
            type="button"
            onClick={() => {
              setSession(item.session_id);
            }}
          >
            {item.failed ? (
              <ActivityIcon className="text-destructive" />
            ) : (
              <CheckIcon />
            )}
            <span className="min-w-0 flex-1 text-left">
              <span className="type-label">
                {new Date(item.last_at).toLocaleString(locale, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
              <small className="block type-caption text-muted-foreground">
                {item.session_id.startsWith("replay:")
                  ? t("Interface")
                  : item.session_id.startsWith("server:")
                    ? t("Servidor")
                    : t("Agente")}{" "}
                · {item.events} {t("eventos")}
                {item.feedback ? ` · ${t("Feedback")}` : ""}
              </small>
            </span>
            <ChevronRightIcon />
          </button>
        ))}
      </div>
      {state.data?.sessions.length === 0 && (
        <p className="type-body text-muted-foreground">
          {t("As experiências vão aparecer aqui.")}
        </p>
      )}
      {session && (
        <DiagnosticSession
          key={session}
          sessionId={session}
          platform={platform}
          onClose={() => {
            setSession(null);
          }}
        />
      )}
      {(failed || Boolean(state.error)) && (
        <p role="alert" className="my-4 type-caption">
          {t("Não foi possível carregar os diagnósticos.")}
        </p>
      )}
    </div>
  );
}
