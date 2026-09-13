import type {
  MessageStreamEvent,
  SubagentCalledStreamEvent,
  SubagentCompletedStreamEvent,
} from "eve/client";

export type SubagentSession = SubagentCalledStreamEvent["data"] & {
  readonly completion?: SubagentCompletedStreamEvent["data"];
  readonly task?: string;
  readonly terminalStatus?: "complete" | "failed" | "cancelled";
};

export type SubagentStatus =
  | "cancelled"
  | "complete"
  | "failed"
  | "ready"
  | "starting"
  | "working";

export function collectSubagentSessions(
  events: readonly MessageStreamEvent[]
): readonly SubagentSession[] {
  const completions = new Map<string, SubagentCompletedStreamEvent["data"]>();
  const tasks = new Map<string, string>();
  const terminalStatuses = terminalTaskStatuses(events);
  const sessions = new Map<string, SubagentSession>();

  for (const event of events) {
    if (event.type === "subagent.completed") {
      completions.set(event.data.callId, event.data);
      continue;
    }
    if (event.type === "actions.requested") {
      for (const action of event.data.actions) {
        if (
          action.kind === "subagent-call" ||
          action.kind === "remote-agent-call"
        ) {
          tasks.set(action.callId, action.description);
        }
      }
    }
  }

  for (const event of events) {
    if (event.type !== "subagent.called") continue;

    const completion = completions.get(event.data.callId);
    const taskId = completion?.backgroundTask?.taskId;
    const session = {
      ...event.data,
      completion,
      task: tasks.get(event.data.callId),
      terminalStatus: taskId ? terminalStatuses.get(taskId) : undefined,
    };
    sessions.delete(session.childSessionId);
    sessions.set(session.childSessionId, session);
  }

  return [...sessions.values()].toReversed();
}

function terminalTaskStatuses(events: readonly MessageStreamEvent[]) {
  const statuses = new Map<string, SubagentSession["terminalStatus"]>();
  for (const event of events) {
    if (event.type !== "message.received" || event.data.source !== "task")
      continue;
    const notification =
      /^Background task (\S+) \([^\r\n]+\) (is completed|failed|is cancelled)\./u.exec(
        event.data.message
      );
    if (!notification?.[1]) continue;
    const state = notification[2];
    statuses.set(
      notification[1],
      state === "is completed"
        ? "complete"
        : state === "failed"
          ? "failed"
          : "cancelled"
    );
  }
  return statuses;
}

export function getSubagentSubscriptionKey(
  sessions: readonly SubagentSession[]
) {
  return sessions
    .map(
      (session) =>
        `${encodeURIComponent(session.childSessionId)}:${encodeURIComponent(session.callId)}`
    )
    .join("\n");
}

export function getSubagentStatus(
  events: readonly MessageStreamEvent[],
  session: SubagentSession
): SubagentStatus {
  if (session.terminalStatus) return session.terminalStatus;
  const terminalSession = events
    .toReversed()
    .find((event) =>
      ["session.completed", "session.failed"].includes(event.type)
    );
  if (terminalSession?.type === "session.completed") return "complete";
  if (terminalSession?.type === "session.failed") return "failed";

  const latestTurnBoundary = events
    .toReversed()
    .find((event) =>
      [
        "turn.cancelled",
        "turn.completed",
        "turn.failed",
        "turn.started",
      ].includes(event.type)
    );
  if (latestTurnBoundary?.type === "turn.failed") return "failed";
  if (latestTurnBoundary?.type === "turn.cancelled") return "cancelled";
  if (latestTurnBoundary?.type === "turn.completed") return "ready";
  if (latestTurnBoundary?.type === "turn.started") return "working";
  if (events.some((event) => event.type === "session.waiting")) return "ready";
  if (session.completion && !session.completion.backgroundTask) return "ready";
  return "starting";
}

export function getSubagentTask(events: readonly MessageStreamEvent[]) {
  const message = events.find((event) => event.type === "message.received")
    ?.data.message;
  return message
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^Task:\s*/iu, "");
}
