"use client";

import { useI18n } from "@web/i18n/context";
import { cn } from "@web/components/class-names";
import { PanelIntro } from "../_components/panel-intro";
import { Button } from "@web/components/ui/button";
import styles from "../_components/panel.module.css";
import type { Effect } from "effect";
import Link from "next/link";
import type { listReminders } from "../../../server/schedules/queries";
import { Badge } from "@web/components/ui/badge";
import { PauseIcon, PlayIcon } from "lucide-react";
import { api } from "@web/trpc/client";

const jobLabels = {
  active: "Ativa",
  paused: "Pausada",
  completed: "Sem próximas ocorrências",
} as const;
const runLabels = {
  queued: "Aguardando execução",
  running: "Em andamento",
  waiting_for_input: "Aguardando resposta",
  completed: "Concluída",
  dead_letter: "Falhou",
} as const;
const reportLabels = {
  not_ready: "Relatório em preparação",
  not_needed: "Sem relatório",
  pending: "Relatório pendente",
  queued: "Relatório na fila",
  delivered: "Relatório entregue",
  suppressed: "Relatório suprimido",
  failed: "Entrega falhou; partes podem ter sido enviadas",
  cancelled: "Entrega interrompida; partes podem ter sido enviadas",
  uncertain: "Entrega incerta; nova tentativa automática bloqueada",
} as const;
const channelLabels = {
  eve: "Zoen",
  linq: "Linq",
  telegram: "Telegram",
  kapso: "WhatsApp",
} as const;

type ReminderPage = Effect.Success<ReturnType<typeof listReminders>>;

export function ReminderList({ reminders, hasMore }: ReminderPage) {
  const { t } = useI18n();
  return (
    <>
      {reminders.length === 0 ? (
        <>
          <PanelIntro
            image="/marketing/panel/zoen-calm.jpg"
            title={t("Cuide do agora.")}
            description={t("Eu lembro do depois.")}
          />
          <div className={styles.actions}>
            <Button
              nativeButton={false}
              render={<Link href="/chat?starter=reminder" />}
            >
              {t("Criar minha primeira automação")}
            </Button>
            <Link className={styles.subtleLink} href="/recipes">
              {t("Explorar ideias")}
            </Link>
          </div>
        </>
      ) : (
        <ul className="space-y-4">
          {reminders.map((reminder) => (
            <ReminderCard key={reminder.id} reminder={reminder} />
          ))}
        </ul>
      )}
      {hasMore ? (
        <p className="type-caption text-muted-foreground">
          {t(
            "Mostrando os primeiros 50 agendamentos, com os ativos primeiro. Os demais estão disponíveis nas conversas originais."
          )}
        </p>
      ) : null}
      {reminders.length > 0 && (
        <p className="type-caption text-muted-foreground">
          {t(
            "Horários em UTC. Um agendamento sem próximas ocorrências ainda pode ter uma execução ou entrega em andamento."
          )}
        </p>
      )}
    </>
  );
}

function ReminderCard({
  reminder: original,
}: {
  readonly reminder: ReminderPage["reminders"][number];
}) {
  const { t, locale } = useI18n();
  const update = api.workspaces.schedules.setStatus.useMutation();
  const reminder = { ...original, ...update.data };
  const nextRunAt = reminder.nextRunAt ? new Date(reminder.nextRunAt) : null;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return (
    <li className={cn("space-y-3", styles.sectionCard)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t(jobLabels[reminder.status])}</Badge>
        <span className="type-caption text-muted-foreground">
          {channelLabels[reminder.conversationChannel]}
        </span>
        {reminder.mayManage && reminder.status !== "completed" && (
          <Button
            variant="ghost"
            className="ml-auto"
            disabled={update.isPending}
            onClick={() => {
              update.mutate({
                id: reminder.id,
                revision: reminder.revision,
                status: reminder.status === "active" ? "paused" : "active",
              });
            }}
          >
            {reminder.status === "active" ? (
              <PauseIcon aria-hidden="true" />
            ) : (
              <PlayIcon aria-hidden="true" />
            )}
            {t(reminder.status === "active" ? "Pausar" : "Retomar")}
          </Button>
        )}
      </div>
      {update.error && (
        <p role="alert" className="type-caption">
          {t("Não foi possível atualizar. Tente novamente.")}
        </p>
      )}
      <p className="type-supporting-body wrap-break-word whitespace-pre-wrap">
        {reminder.prompt}
      </p>
      <dl className="space-y-1 type-caption text-muted-foreground">
        <div>
          <dt className="inline">
            {reminder.status === "paused"
              ? t("Próxima ocorrência salva: ")
              : t("Próxima ocorrência: ")}
          </dt>
          <dd className="inline">
            {nextRunAt ? (
              <time dateTime={nextRunAt.toISOString()}>
                {dateFormatter.format(nextRunAt)} UTC
              </time>
            ) : (
              t("Nenhuma agendada")
            )}
          </dd>
        </div>
        {reminder.latestRunStatus ? (
          <div>
            <dt className="inline">{t("Última execução:")} </dt>
            <dd className="inline">
              {t(runLabels[reminder.latestRunStatus])}
              {reminder.latestScheduledFor
                ? ` · ${dateFormatter.format(reminder.latestScheduledFor)} UTC`
                : ""}
            </dd>
          </div>
        ) : null}
        {reminder.latestReportStatus ? (
          <div>
            <dt className="inline">{t("Entrega:")} </dt>
            <dd className="inline">
              {t(reportLabels[reminder.latestReportStatus])}
            </dd>
          </div>
        ) : null}
      </dl>
      {reminder.originalSessionId ? (
        <Link
          className="type-label underline underline-offset-4"
          href={`/chat/${encodeURIComponent(reminder.originalSessionId)}`}
        >
          {t("Abrir conversa original")}
        </Link>
      ) : (
        <p className="type-caption text-muted-foreground">
          {reminder.conversationChannel !== "eve"
            ? t(
                "Gerencie este agendamento na conversa original no {channel}.",
                { channel: channelLabels[reminder.conversationChannel] }
              )
            : t("A conversa original não está disponível nesta conta.")}
        </p>
      )}
    </li>
  );
}
