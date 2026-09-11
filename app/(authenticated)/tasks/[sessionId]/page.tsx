import {
  listBrowserTraceEvents,
  readBrowserTrace,
} from "@db/services/browser-traces";
import { requireRequestScope } from "@web/auth/request-scope";
import { browserTraceActivityDurations } from "@web/browser/activity";
import { ActivityDurationBreakdown } from "@web/components/browser/activity-duration-breakdown";
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
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { RefreshButton } from "./_components/refresh-button";

const statusText = {
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

function resolveTraceStatus(status: string) {
  const parsed = traceStatusSchema.safeParse(status);

  if (parsed.success) return statusText[parsed.data];

  return { label: status, variant: "secondary" as const };
}

function formatTraceDuration(durationMs: number | null): string {
  if (durationMs === null) return "Duration unavailable";

  return `${String(Math.round(durationMs / 1000))}s`;
}

function traceMetaLine(options: {
  readonly durationMs: number | null;
  readonly startedAt: string;
  readonly domains: readonly string[];
}): string {
  const parts = [
    formatTraceDuration(options.durationMs),
    `Started ${options.startedAt}`,
  ];

  if (options.domains.length > 0) {
    parts.push(options.domains.join(", "));
  }

  return parts.join(" · ");
}

function TraceResultMessage({ message }: { readonly message: string | null }) {
  if (!message) return null;

  return (
    <p className="type-supporting-body mt-1 truncate" title={message}>
      {message}
    </p>
  );
}

function TraceEventsTable({
  events,
}: {
  readonly events: Awaited<ReturnType<typeof listBrowserTraceEvents>>;
}) {
  if (events.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={3} variant="empty">
          No events recorded for this trace.
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {events.map((event) => (
        <TableRow key={event.id}>
          <TableCell className="truncate text-muted-foreground">
            {new Date(event.at).toLocaleTimeString()}
          </TableCell>
          <TableCell className="truncate" title={event.label}>
            {event.label}
          </TableCell>
          <TableCell
            className="truncate text-muted-foreground"
            title={event.detail}
          >
            {event.detail || "—"}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default async function TraceDetailPage({
  params,
}: PageProps<"/tasks/[sessionId]">) {
  const scope = await requireRequestScope();
  const { sessionId } = await params;
  const trace = await readBrowserTrace(scope, sessionId);

  if (!trace) notFound();

  const status = resolveTraceStatus(trace.status);
  const events = await listBrowserTraceEvents(scope, trace.sessionId);
  const activityEnd = trace.completedAt ?? events.at(-1)?.at ?? trace.startedAt;

  const activityDurations = browserTraceActivityDurations(
    events,
    new Date(activityEnd).getTime()
  );

  return (
    <div className="flex w-full flex-col gap-6 px-4 py-6 sm:p-8">
      <header className="flex flex-col gap-4">
        <div>
          <Button
            nativeButton={false}
            render={<Link href="/tasks" />}
            size="sm"
            variant="ghost"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            All traces
          </Button>
        </div>
        <div className="max-w-4xl">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate type-card-title" title={trace.task}>
              {trace.task}
            </h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="type-supporting-body mt-2 truncate text-muted-foreground">
            {traceMetaLine({
              durationMs: trace.durationMs,
              startedAt: trace.startedAt,
              domains: trace.domains,
            })}
          </p>
          <TraceResultMessage message={trace.resultMessage} />
          <div className="mt-4 max-w-4xl">
            <ActivityDurationBreakdown durations={activityDurations} />
          </div>
        </div>
      </header>

      <section aria-label="Trace events" className="grid gap-4">
        <div className="flex items-center justify-end gap-4 type-label">
          {events.length > 0 ? (
            <span>{String(events.length)} events</span>
          ) : null}
          <RefreshButton />
        </div>

        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[10%]">Time</TableHead>
              <TableHead className="w-[16%]">Event</TableHead>
              <TableHead className="w-[74%]">Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TraceEventsTable events={events} />
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
