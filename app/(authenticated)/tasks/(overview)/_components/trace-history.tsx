"use client";

import type { BrowserTracePage } from "@db/services/browser-traces";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table";
import { api } from "@web/trpc/client";
import { RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { z } from "zod";

const statusLabels = {
  cancelled: { label: "Cancelled", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
  failure: { label: "Failed", variant: "warning" },
  running: { label: "Running", variant: "information" },
  success: { label: "Succeeded", variant: "success" },
} as const;

const traceStatusSchema = z.enum([
  "cancelled",
  "error",
  "failure",
  "running",
  "success",
]);

type TraceRow = BrowserTracePage["traces"][number];

function statusLabel(status: string) {
  const parsed = traceStatusSchema.safeParse(status);

  if (parsed.success) return statusLabels[parsed.data];

  return { label: status, variant: "secondary" as const };
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return "—";

  if (durationMs < 1000) return "<1s";
  const seconds = Math.round(durationMs / 1000);

  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;

  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

function historyErrorMessage(
  cause: unknown,
  hasData: boolean,
  initialError?: string
): string | undefined {
  if (cause instanceof Error) return cause.message;

  if (cause) return "Unable to load browser traces";

  if (hasData) return undefined;

  return initialError;
}

function emptyTracesMessage(isFetching: boolean): string {
  if (isFetching) return "Loading browser traces…";

  return "No browser traces yet. Give the agent a browser task from the chat.";
}

function TraceDomainsCell({
  domains,
}: {
  readonly domains: readonly string[];
}) {
  if (domains.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return domains.join(", ");
}

function TraceHistoryRow({ trace }: { readonly trace: TraceRow }) {
  const status = statusLabel(trace.status);

  return (
    <TableRow>
      <TableCell className="truncate" title={trace.task}>
        <Button
          nativeButton={false}
          render={<Link href={`/tasks/${trace.sessionId}`} />}
          size="none"
          variant="link"
        >
          {trace.task}
        </Button>
      </TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className="truncate">
        {formatDuration(trace.durationMs)}
      </TableCell>
      <TableCell className="truncate" title={trace.domains.join(", ")}>
        <TraceDomainsCell domains={trace.domains} />
      </TableCell>
      <TableCell
        className="truncate text-muted-foreground"
        title={trace.resultMessage ?? undefined}
      >
        {trace.resultMessage ?? "—"}
      </TableCell>
      <TableCell
        className="truncate text-muted-foreground"
        suppressHydrationWarning
      >
        {new Date(trace.startedAt).toLocaleString()}
      </TableCell>
    </TableRow>
  );
}

function TraceHistoryBody({
  traces,
  isFetching,
}: {
  readonly traces: readonly TraceRow[];
  readonly isFetching: boolean;
}) {
  if (traces.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6} variant="empty">
          {emptyTracesMessage(isFetching)}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {traces.map((trace) => (
        <TraceHistoryRow key={trace.sessionId} trace={trace} />
      ))}
    </>
  );
}

function TraceHistoryToolbar({
  traces,
  isFetching,
  onRefresh,
}: {
  readonly traces: readonly TraceRow[];
  readonly isFetching: boolean;
  readonly onRefresh: () => void;
}) {
  const succeeded = traces.filter((trace) => trace.status === "success").length;

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 type-label">
      {traces.length > 0 ? (
        <>
          <span>{String(traces.length)} loaded</span>
          <Badge variant="success">{String(succeeded)} succeeded</Badge>
        </>
      ) : null}
      <Button
        disabled={isFetching}
        onClick={onRefresh}
        size="sm"
        type="button"
        variant="outline"
      >
        <RefreshCwIcon className={isFetching ? "animate-spin" : undefined} />
        Refresh
      </Button>
    </div>
  );
}

function LoadOlderButton({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadMore: () => void;
}) {
  if (!hasNextPage) return null;

  return (
    <Button
      className="justify-self-center"
      disabled={isFetchingNextPage}
      onClick={onLoadMore}
      type="button"
      variant="outline"
    >
      {isFetchingNextPage ? "Loading…" : "Load older traces"}
    </Button>
  );
}

function buildQueryOptions(initialPage?: BrowserTracePage) {
  const queryOptions = {
    getNextPageParam: (page: BrowserTracePage) => page.nextCursor ?? undefined,
    initialCursor: null,
    staleTime: 30 * 1000,
  };

  if (!initialPage) return queryOptions;

  return {
    ...queryOptions,
    initialData: { pageParams: [null], pages: [initialPage] },
  };
}

function uniqueTraces(pages: BrowserTracePage[] | undefined): TraceRow[] {
  return [
    ...new Map(
      (pages ?? [])
        .flatMap((page) => page.traces)
        .map((trace) => [trace.sessionId, trace])
    ).values(),
  ];
}

export function TraceHistory({
  initialError,
  initialPage,
}: {
  readonly initialError?: string;
  readonly initialPage?: BrowserTracePage;
}) {
  const history = api.traces.list.useInfiniteQuery(
    {},
    buildQueryOptions(initialPage)
  );

  const traces = useMemo(
    () => uniqueTraces(history.data?.pages),
    [history.data?.pages]
  );

  const historyError = historyErrorMessage(
    history.error,
    Boolean(history.data),
    initialError
  );

  return (
    <section aria-label="Browser trace history" className="grid gap-4">
      <TraceHistoryToolbar
        isFetching={history.isFetching}
        traces={traces}
        onRefresh={() => {
          void history.refetch();
        }}
      />

      {historyError ? (
        <Alert variant="destructive">
          <AlertDescription>{historyError}</AlertDescription>
        </Alert>
      ) : null}

      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[26%]">Task</TableHead>
            <TableHead className="w-[9%]">Status</TableHead>
            <TableHead className="w-[8%]">Duration</TableHead>
            <TableHead className="w-[18%]">Domains</TableHead>
            <TableHead className="w-[25%]">Result</TableHead>
            <TableHead className="w-[14%]">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TraceHistoryBody isFetching={history.isFetching} traces={traces} />
        </TableBody>
      </Table>

      <LoadOlderButton
        hasNextPage={history.hasNextPage}
        isFetchingNextPage={history.isFetchingNextPage}
        onLoadMore={() => {
          void history.fetchNextPage();
        }}
      />
    </section>
  );
}
