import { ArrowLeftIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@web/components/ui/badge";
import { cn } from "@web/components/class-names";
import { Button } from "@web/components/ui/button";
import { ActivityDurationBreakdown } from "@web/components/browser/activity-duration-breakdown";
import {
  listBrowserTraceEvents,
  readBrowserTrace,
} from "@db/services/browser-traces";
import { requireRequestScope } from "@web/auth/request-scope";
import { browserTraceActivityDurations } from "@web/browser/activity";
import { RefreshButton } from "./_components/refresh-button";
import { PanelLink } from "../../_components/panel-link";
import {
  formatTraceDuration,
  traceStatusLabel,
} from "../_lib/trace-presentation";
import styles from "../_components/activity.module.css";

export default async function TraceDetailPage({
  params,
}: PageProps<"/tasks/[sessionId]">) {
  const scope = await requireRequestScope();
  const { sessionId } = await params;
  const trace = await readBrowserTrace(scope, sessionId);
  if (!trace) notFound();
  const status = traceStatusLabel(trace.status);
  const events = await listBrowserTraceEvents(scope, trace.sessionId);
  const activityEnd = trace.completedAt ?? events.at(-1)?.at ?? trace.startedAt;
  const activityDurations = browserTraceActivityDurations(
    events,
    new Date(activityEnd).getTime()
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Button
            nativeButton={false}
            render={<PanelLink href="/tasks" />}
            size="sm"
            variant="ghost"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Atividade
          </Button>
        </div>
        <div className={styles.detailTitle}>
          <div className="grid min-w-0 justify-items-start gap-4">
            <Badge variant={status.variant}>{status.label}</Badge>
            <h1 className="type-page-title">{trace.task}</h1>
          </div>
          <div className={cn(styles.metadata, "mt-4 type-caption")}>
            {trace.durationMs !== null && (
              <span>{formatTraceDuration(trace.durationMs)}</span>
            )}
            <time dateTime={trace.startedAt}>
              {new Date(trace.startedAt).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </time>
          </div>
          {trace.domains.length > 0 && (
            <p className="type-caption">{trace.domains.join(" · ")}</p>
          )}
          {trace.resultMessage ? (
            <p className="type-supporting-body">{trace.resultMessage}</p>
          ) : null}
          <div className="mt-4 max-w-4xl">
            <ActivityDurationBreakdown durations={activityDurations} />
          </div>
        </div>
      </header>

      <section aria-label="Etapas da atividade" className="grid min-w-0 gap-4">
        <div className={styles.toolbar}>
          {events.length > 0 ? (
            <span className="type-label">
              {events.length} {events.length === 1 ? "etapa" : "etapas"}
            </span>
          ) : null}
          <RefreshButton />
        </div>

        {events.length === 0 ? (
          <p className="type-supporting-body text-muted-foreground">
            Nenhuma etapa registrada ainda.
          </p>
        ) : (
          <ol className={styles.list}>
            {events.map((event) => (
              <li className={styles.card} key={event.id}>
                <time
                  className="type-caption text-muted-foreground"
                  dateTime={event.at}
                >
                  {new Date(event.at).toLocaleTimeString("pt-BR")}
                </time>
                <h2 className="type-card-title">{event.label}</h2>
                {event.detail && (
                  <p className="type-supporting-body">{event.detail}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
