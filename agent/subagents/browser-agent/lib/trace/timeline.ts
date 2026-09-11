import { Match } from "effect";
import type { HookEvent } from "eve/hooks";
import { z } from "zod";

export interface TraceTimelineRow {
  readonly at: string;
  readonly detail: string;
  readonly id: string;
  readonly label: string;
  readonly type: string;
}

const detailCharacterLimit = 600;

function truncateDetailString(value: string) {
  if (value.length <= 200) return value;

  return `${value.slice(0, 200)}… [${String(value.length)} chars]`;
}

function compactJson(value: Parameters<typeof JSON.stringify>[0]) {
  const serialized = JSON.stringify(value, (_key, entry) => {
    const text = z.string().safeParse(entry);

    if (text.success) return truncateDetailString(text.data);

    const jsonValue = z.json().safeParse(entry);

    return jsonValue.success ? jsonValue.data : undefined;
  });

  if (serialized.length <= detailCharacterLimit) return serialized;

  return `${serialized.slice(0, detailCharacterLimit)}…`;
}

function makeRow(
  event: HookEvent,
  id: string,
  at: string,
  label: string,
  detail: string
): TraceTimelineRow {
  return {
    at,
    detail: detail.slice(0, detailCharacterLimit),
    id,
    label,
    type: event.type,
  };
}

function actionLabel(action: {
  readonly kind: string;
  readonly name?: string;
  readonly toolName?: string;
}) {
  if (action.kind === "tool-call" || action.kind === "workflow-tool-call") {
    return action.toolName ?? action.kind;
  }

  if (action.kind === "load-skill") return "Load skill";

  return action.name ?? action.kind;
}

function rowsForActionsRequested(
  event: Extract<HookEvent, { type: "actions.requested" }>,
  id: string,
  at: string
): TraceTimelineRow[] {
  return event.data.actions.map((action, index) => ({
    at,
    detail: compactJson(action.input),
    id: `${id}:${String(index)}`,
    label: actionLabel(action),
    type: event.type,
  }));
}

function resultName(
  result: Extract<HookEvent, { type: "action.result" }>["data"]["result"]
) {
  return Match.value(result).pipe(
    Match.when({ kind: "tool-result" }, (value) => value.toolName),
    Match.when({ kind: "subagent-result" }, (value) => value.subagentName),
    Match.orElse(() => "load-skill" as const)
  );
}

function rowsForActionResult(
  event: Extract<HookEvent, { type: "action.result" }>,
  id: string,
  at: string
): TraceTimelineRow[] {
  const result = event.data.result;
  const status = result.isError ? "error" : "result";

  return [
    makeRow(
      event,
      id,
      at,
      `${resultName(result)} → ${status}`,
      compactJson(result.output)
    ),
  ];
}

const simpleTimelineLabels = {
  "turn.cancelled": "Turn cancelled",
  "turn.completed": "Turn completed",
  "session.started": "Session started",
  "session.failed": "Session failed",
  "session.completed": "Session completed",
  "compaction.requested": "Context compaction",
} as const;

type SimpleTimelineType = keyof typeof simpleTimelineLabels;

function isSimpleTimelineType(type: string): type is SimpleTimelineType {
  return type in simpleTimelineLabels;
}

function rowsForSimpleEvent(
  event: HookEvent,
  id: string,
  at: string
): TraceTimelineRow[] | null {
  if (!isSimpleTimelineType(event.type)) return null;

  return [makeRow(event, id, at, simpleTimelineLabels[event.type], "")];
}

function rowsForTypedEvent(
  event: HookEvent,
  id: string,
  at: string
): TraceTimelineRow[] {
  switch (event.type) {
    case "message.received":
      return [makeRow(event, id, at, "Task received", event.data.message)];
    case "actions.requested":
      return rowsForActionsRequested(event, id, at);
    case "action.result":
      return rowsForActionResult(event, id, at);
    case "message.completed":
      return [makeRow(event, id, at, "Assistant", event.data.message ?? "")];
    case "result.completed":
      return [
        makeRow(event, id, at, "Final output", compactJson(event.data.result)),
      ];
    case "input.requested":
      return [
        makeRow(
          event,
          id,
          at,
          "Input requested",
          `${String(event.data.requests.length)} pending request(s)`
        ),
      ];
    case "input.resolved":
      return [
        makeRow(
          event,
          id,
          at,
          "Input resolved",
          compactJson(event.data.resolutions)
        ),
      ];
    case "authorization.required":
      return [
        makeRow(event, id, at, "Authorization required", event.data.name),
      ];
    case "authorization.completed":
      return [makeRow(event, id, at, "Authorization", event.data.outcome)];
    case "step.failed":
      return [makeRow(event, id, at, "Step failed", event.data.message)];
    case "turn.failed":
      return [makeRow(event, id, at, "Turn failed", event.data.message)];
    default:
      return rowsForSimpleEvent(event, id, at) ?? [];
  }
}

export function traceTimelineRows(event: HookEvent): TraceTimelineRow[] {
  const id = event.meta.id;

  if (!id) return [];

  return rowsForTypedEvent(event, id, event.meta.at);
}
