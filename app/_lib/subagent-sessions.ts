import type {
  MessageStreamEvent,
  SubagentCalledStreamEvent,
  SubagentCompletedStreamEvent,
} from "eve/client";

export type SubagentSession = SubagentCalledStreamEvent["data"] & {
  readonly completion?: SubagentCompletedStreamEvent["data"];
  readonly task?: string;
};

export type SubagentStatus =
  | "cancelled"
  | "complete"
  | "failed"
  | "ready"
  | "starting"
  | "working";

function recordSubagentCompletions(
  events: readonly MessageStreamEvent[]
): Map<string, SubagentCompletedStreamEvent["data"]> {
  const completions = new Map<string, SubagentCompletedStreamEvent["data"]>();

  for (const event of events) {
    if (event.type !== "subagent.completed") {
      continue;
    }

    completions.set(event.data.callId, event.data);
  }

  return completions;
}

function recordTaskFromAction(
  tasks: Map<string, string>,
  action: { callId: string; description: string; kind: string }
) {
  if (action.kind !== "subagent-call" && action.kind !== "remote-agent-call") {
    return;
  }

  tasks.set(action.callId, action.description);
}

function recordTasksFromEvent(
  tasks: Map<string, string>,
  event: MessageStreamEvent
) {
  if (event.type !== "actions.requested") {
    return;
  }

  for (const action of event.data.actions) {
    recordTaskFromAction(tasks, action);
  }
}

function recordSubagentTasks(
  events: readonly MessageStreamEvent[]
): Map<string, string> {
  const tasks = new Map<string, string>();

  for (const event of events) {
    recordTasksFromEvent(tasks, event);
  }

  return tasks;
}

function recordCalledSessions(
  events: readonly MessageStreamEvent[],
  completions: Map<string, SubagentCompletedStreamEvent["data"]>,
  tasks: Map<string, string>
): Map<string, SubagentSession> {
  const sessions = new Map<string, SubagentSession>();

  for (const event of events) {
    if (event.type !== "subagent.called") {
      continue;
    }

    const session = {
      ...event.data,
      completion: completions.get(event.data.callId),
      task: tasks.get(event.data.callId),
    };

    sessions.delete(session.childSessionId);
    sessions.set(session.childSessionId, session);
  }

  return sessions;
}

export function collectSubagentSessions(
  events: readonly MessageStreamEvent[]
): readonly SubagentSession[] {
  const completions = recordSubagentCompletions(events);
  const tasks = recordSubagentTasks(events);
  const sessions = recordCalledSessions(events, completions, tasks);

  return [...sessions.values()].toReversed();
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

function findLastMatchingType(
  events: readonly MessageStreamEvent[],
  types: ReadonlySet<string>
) {
  return events.toReversed().find((event) => types.has(event.type));
}

const sessionTerminalTypes = new Set(["session.completed", "session.failed"]);

function statusFromSessionTerminal(
  events: readonly MessageStreamEvent[]
): SubagentStatus | undefined {
  const terminal = findLastMatchingType(events, sessionTerminalTypes);

  if (terminal?.type === "session.completed") {
    return "complete";
  }

  if (terminal?.type === "session.failed") {
    return "failed";
  }

  return undefined;
}

const turnBoundaryTypes = new Set([
  "turn.cancelled",
  "turn.completed",
  "turn.failed",
  "turn.started",
]);

function statusFromTurnBoundary(
  events: readonly MessageStreamEvent[]
): SubagentStatus | undefined {
  const boundary = findLastMatchingType(events, turnBoundaryTypes);

  if (boundary?.type === "turn.failed") {
    return "failed";
  }

  if (boundary?.type === "turn.cancelled") {
    return "cancelled";
  }

  if (boundary?.type === "turn.completed") {
    return "ready";
  }

  if (boundary?.type === "turn.started") {
    return "working";
  }

  return undefined;
}

function hasWaitingSession(events: readonly MessageStreamEvent[]) {
  return events.some((event) => event.type === "session.waiting");
}

function isForegroundComplete(session: SubagentSession) {
  return Boolean(session.completion && !session.completion.backgroundTask);
}

export function getSubagentStatus(
  events: readonly MessageStreamEvent[],
  session: SubagentSession
): SubagentStatus {
  const fromTerminal = statusFromSessionTerminal(events);

  if (fromTerminal) {
    return fromTerminal;
  }

  const fromTurn = statusFromTurnBoundary(events);

  if (fromTurn) {
    return fromTurn;
  }

  if (hasWaitingSession(events)) {
    return "ready";
  }

  if (isForegroundComplete(session)) {
    return "ready";
  }

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
