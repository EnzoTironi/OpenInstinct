import { cn } from "@web/components/class-names";
import { PanelIntro } from "../_components/panel-intro";
import { Button } from "@web/components/ui/button";
import styles from "../_components/panel.module.css";
import type { Effect } from "effect";
import Link from "next/link";
import type { listReminders } from "../../../server/schedules/queries";
import { Badge } from "@web/components/ui/badge";

const jobLabels = {
  active: "Ativa",
  paused: "Pausada",
  completed: "Sem próximas ocorrências",
};
const runLabels = {
  queued: "Aguardando execução",
  running: "Em andamento",
  waiting_for_input: "Aguardando resposta",
  completed: "Concluída",
  dead_letter: "Falhou",
};
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
};
const channelLabels = {
  eve: "Zoen",
  linq: "Linq",
  telegram: "Telegram",
  kapso: "WhatsApp",
};
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

type ReminderPage = Effect.Success<ReturnType<typeof listReminders>>;

export function ReminderList({ reminders, hasMore }: ReminderPage) {
  return (
    <>
      {reminders.length === 0 ? (
        <>
          <PanelIntro
            image="/marketing/panel/zoen-calm.jpg"
            title="Cuide do agora."
            description="Eu lembro do depois."
          />
          <div className={styles.actions}>
            <Button
              nativeButton={false}
              render={<Link href="/chat?starter=reminder" />}
            >
              Criar minha primeira automação
            </Button>
            <Link className={styles.subtleLink} href="/recipes">
              Explorar ideias
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
          Mostrando os primeiros 50 agendamentos, com os ativos primeiro. Os
          demais estão disponíveis nas conversas originais.
        </p>
      ) : null}
      {reminders.length > 0 && (
        <p className="type-caption text-muted-foreground">
          Horários em UTC. Um agendamento sem próximas ocorrências ainda pode
          ter uma execução ou entrega em andamento.
        </p>
      )}
    </>
  );
}

function ReminderCard({
  reminder,
}: {
  readonly reminder: ReminderPage["reminders"][number];
}) {
  return (
    <li className={cn("space-y-3", styles.sectionCard)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{jobLabels[reminder.status]}</Badge>
        <span className="type-caption text-muted-foreground">
          {channelLabels[reminder.conversationChannel]}
        </span>
      </div>
      <p className="type-supporting-body wrap-break-word whitespace-pre-wrap">
        {reminder.prompt}
      </p>
      <dl className="space-y-1 type-caption text-muted-foreground">
        <div>
          <dt className="inline">
            {reminder.status === "paused"
              ? "Próxima ocorrência salva: "
              : "Próxima ocorrência: "}
          </dt>
          <dd className="inline">
            {reminder.nextRunAt ? (
              <time dateTime={reminder.nextRunAt.toISOString()}>
                {dateFormatter.format(reminder.nextRunAt)} UTC
              </time>
            ) : (
              "Nenhuma agendada"
            )}
          </dd>
        </div>
        {reminder.latestRunStatus ? (
          <div>
            <dt className="inline">Última execução: </dt>
            <dd className="inline">
              {runLabels[reminder.latestRunStatus]}
              {reminder.latestScheduledFor
                ? ` · ${dateFormatter.format(reminder.latestScheduledFor)} UTC`
                : ""}
            </dd>
          </div>
        ) : null}
        {reminder.latestReportStatus ? (
          <div>
            <dt className="inline">Entrega: </dt>
            <dd className="inline">
              {reportLabels[reminder.latestReportStatus]}
            </dd>
          </div>
        ) : null}
      </dl>
      {reminder.originalSessionId ? (
        <Link
          className="type-label underline underline-offset-4"
          href={`/chat/${encodeURIComponent(reminder.originalSessionId)}`}
        >
          Abrir conversa original
        </Link>
      ) : (
        <p className="type-caption text-muted-foreground">
          {reminder.conversationChannel !== "eve"
            ? `Gerencie este agendamento na conversa original no ${channelLabels[reminder.conversationChannel]}.`
            : "A conversa original não está disponível nesta conta."}
        </p>
      )}
    </li>
  );
}
