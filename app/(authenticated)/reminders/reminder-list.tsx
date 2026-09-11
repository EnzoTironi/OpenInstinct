import { Badge } from "@web/components/ui/badge";
import type { Effect } from "effect";
import Link from "next/link";

import type { listReminders } from "../../../server/schedules/queries";

const jobLabels = {
  active: "Active",
  paused: "Paused",
  completed: "No future occurrences",
};

const runLabels = {
  queued: "Waiting to run",
  running: "In progress",
  waiting_for_input: "Waiting for a response",
  completed: "Run finished",
  dead_letter: "Run failed",
};

const reportLabels = {
  not_ready: "Report not ready",
  not_needed: "No report needed",
  pending: "Report pending",
  queued: "Report queued",
  delivered: "Report delivered",
  suppressed: "Report suppressed",
  failed: "Delivery failed; some parts may have been sent",
  cancelled: "Delivery stopped; some parts may have been sent",
  uncertain: "Delivery uncertain; automatic retry blocked",
};

const channelLabels = {
  eve: "Companion",
  linq: "Linq",
  telegram: "Telegram",
  kapso: "WhatsApp",
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

type ReminderPage = Effect.Success<ReturnType<typeof listReminders>>;

type Reminder = ReminderPage["reminders"][number];

export function ReminderList({ reminders, hasMore }: ReminderPage) {
  return (
    <>
      {reminders.length === 0 ? (
        <p className="type-supporting-body rounded-lg border border-border/50 p-6 text-muted-foreground">
          No reminders to show yet.{" "}
          <Link
            className="text-foreground underline underline-offset-4"
            href="/chat?starter=reminder"
          >
            Create your first reminder
          </Link>{" "}
          with an editable request in chat.
        </p>
      ) : (
        <ul className="space-y-4">
          {reminders.map((reminder) => (
            <ReminderCard key={reminder.id} reminder={reminder} />
          ))}
        </ul>
      )}
      {hasMore ? (
        <p className="type-caption text-muted-foreground">
          Showing the first 50 reminders, with active schedules first. More
          schedules are available in their original conversations.
        </p>
      ) : null}
      <p className="type-caption text-muted-foreground">
        Times are shown in UTC. A schedule with no future occurrences may still
        have a run or report in progress.
      </p>
    </>
  );
}

function nextOccurrenceLabel(status: Reminder["status"]): string {
  if (status === "paused") return "Saved next occurrence: ";

  return "Next occurrence: ";
}

function NextRunValue({ nextRunAt }: { readonly nextRunAt: Date | null }) {
  if (!nextRunAt) return "None scheduled";

  return (
    <time dateTime={nextRunAt.toISOString()}>
      {dateFormatter.format(nextRunAt)} UTC
    </time>
  );
}

function LatestRunRow({ reminder }: { readonly reminder: Reminder }) {
  if (!reminder.latestRunStatus) return null;

  const scheduled = reminder.latestScheduledFor
    ? ` · ${dateFormatter.format(reminder.latestScheduledFor)} UTC`
    : "";

  return (
    <div>
      <dt className="inline">Latest run: </dt>
      <dd className="inline">
        {runLabels[reminder.latestRunStatus]}
        {scheduled}
      </dd>
    </div>
  );
}

function LatestReportRow({ reminder }: { readonly reminder: Reminder }) {
  if (!reminder.latestReportStatus) return null;

  return (
    <div>
      <dt className="inline">Delivery: </dt>
      <dd className="inline">{reportLabels[reminder.latestReportStatus]}</dd>
    </div>
  );
}

function unavailableConversationMessage(reminder: Reminder): string {
  if (reminder.conversationChannel !== "eve") {
    return `Return to the original conversation in ${channelLabels[reminder.conversationChannel]} to manage this schedule.`;
  }

  return "The original conversation is not available to this account.";
}

function ReminderConversationLink({
  reminder,
}: {
  readonly reminder: Reminder;
}) {
  if (reminder.originalSessionId) {
    return (
      <Link
        className="type-label underline underline-offset-4"
        href={`/chat/${encodeURIComponent(reminder.originalSessionId)}`}
      >
        Return to original conversation
      </Link>
    );
  }

  return (
    <p className="type-caption text-muted-foreground">
      {unavailableConversationMessage(reminder)}
    </p>
  );
}

function ReminderCard({ reminder }: { readonly reminder: Reminder }) {
  return (
    <li className="space-y-3 rounded-lg border border-border/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{jobLabels[reminder.status]}</Badge>
        <span className="type-caption text-muted-foreground">
          {channelLabels[reminder.conversationChannel]} conversation
        </span>
      </div>
      <p className="type-supporting-body wrap-break-word whitespace-pre-wrap">
        {reminder.prompt}
      </p>
      <dl className="space-y-1 type-caption text-muted-foreground">
        <div>
          <dt className="inline">{nextOccurrenceLabel(reminder.status)}</dt>
          <dd className="inline">
            <NextRunValue nextRunAt={reminder.nextRunAt} />
          </dd>
        </div>
        <LatestRunRow reminder={reminder} />
        <LatestReportRow reminder={reminder} />
      </dl>
      <ReminderConversationLink reminder={reminder} />
    </li>
  );
}
