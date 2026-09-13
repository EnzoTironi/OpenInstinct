"use client";

import { ArrowUpRightIcon, Clock3Icon, RefreshCwIcon } from "lucide-react";
import Image from "next/image";
import { useMemo } from "react";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import type { BrowserTracePage } from "@db/services/browser-traces";
import { api } from "@web/trpc/client";
import { cn } from "@web/components/class-names";
import { PanelLink } from "../../../_components/panel-link";
import {
  formatTraceDuration,
  traceStatusLabel,
} from "../../_lib/trace-presentation";
import styles from "../../_components/activity.module.css";

export function TraceHistory({
  initialError,
  initialPage,
}: {
  readonly initialError?: string;
  readonly initialPage?: BrowserTracePage;
}) {
  const queryOptions = {
    getNextPageParam: (page: BrowserTracePage) => page.nextCursor ?? undefined,
    initialCursor: null,
    staleTime: 30 * 1000,
  };
  if (initialPage) {
    Object.assign(queryOptions, {
      initialData: { pageParams: [null], pages: [initialPage] },
    });
  }
  const history = api.traces.list.useInfiniteQuery({}, queryOptions);
  const pages = history.data?.pages;
  const traces = useMemo(
    () => [
      ...new Map(
        (pages ?? [])
          .flatMap((page) => page.traces)
          .map((trace) => [trace.sessionId, trace])
      ).values(),
    ],
    [pages]
  );
  const historyError = history.error
    ? history.error instanceof Error
      ? history.error.message
      : "Não foi possível carregar a atividade."
    : history.data
      ? undefined
      : initialError;
  return (
    <section aria-label="Atividade no navegador" className="grid min-w-0 gap-4">
      <div className={styles.toolbar}>
        {traces.length > 0 ? (
          <span className="type-label">
            {traces.length} {traces.length === 1 ? "atividade" : "atividades"}
          </span>
        ) : null}
        <Button
          aria-label="Atualizar atividade"
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
          size="icon"
          type="button"
          variant="outline"
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={history.isFetching ? "animate-spin" : undefined}
          />
        </Button>
      </div>

      {historyError ? (
        <Alert variant="destructive">
          <AlertDescription>{historyError}</AlertDescription>
        </Alert>
      ) : null}

      {traces.length === 0 && !historyError ? (
        history.isLoading ? (
          <output className="type-supporting-body text-muted-foreground">
            Carregando atividade…
          </output>
        ) : (
          <div className={styles.empty}>
            <Image
              alt=""
              height={200}
              width={300}
              sizes="300px"
              src="/marketing/panel/zoen-meeting.png"
            />
            <h2 className="type-section-title">
              Tudo começa com uma conversa.
            </h2>
            <p className="type-supporting-body">
              Peça uma pesquisa ou uma tarefa. Os resultados aparecem aqui.
            </p>
            <Button nativeButton={false} render={<PanelLink href="/chat" />}>
              Abrir conversa
            </Button>
          </div>
        )
      ) : null}

      {traces.length > 0 && (
        <ul className={styles.list}>
          {traces.map((trace) => (
            <TraceHistoryCard key={trace.sessionId} trace={trace} />
          ))}
        </ul>
      )}

      {history.hasNextPage ? (
        <Button
          className="justify-self-center"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
          type="button"
          variant="outline"
        >
          {history.isFetchingNextPage ? "Carregando…" : "Ver mais atividades"}
        </Button>
      ) : null}
    </section>
  );
}

function TraceHistoryCard({
  trace,
}: {
  readonly trace: BrowserTracePage["traces"][number];
}) {
  const status = traceStatusLabel(trace.status);
  return (
    <li>
      <PanelLink
        className={styles.card}
        href={`/tasks/${encodeURIComponent(trace.sessionId)}`}
      >
        <div className={styles.cardTop}>
          <Badge variant={status.variant}>{status.label}</Badge>
          <ArrowUpRightIcon aria-hidden="true" />
        </div>
        <h2 className="type-card-title">{trace.task}</h2>
        {trace.resultMessage && (
          <p className="type-supporting-body">{trace.resultMessage}</p>
        )}
        <div className={cn(styles.metadata, "type-caption")}>
          {trace.durationMs !== null && (
            <span>
              <Clock3Icon aria-hidden="true" />
              {formatTraceDuration(trace.durationMs)}
            </span>
          )}
          <time dateTime={trace.startedAt} suppressHydrationWarning>
            {new Date(trace.startedAt).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </time>
        </div>
        {trace.domains.length > 0 && (
          <p className={cn(styles.domains, "type-caption")}>
            {trace.domains.join(" · ")}
          </p>
        )}
      </PanelLink>
    </li>
  );
}
