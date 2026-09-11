import {
  browserActivityKindForTool,
  type BrowserActivityKind,
  sumBrowserActivityDurations,
} from "@web/browser/activity";
import type { MessageStreamEvent } from "eve/client";
import { z } from "zod";

const toolActivity = new Map<string, string>([
  ["browser_act", "Acting in the browser"],
  ["browser_find", "Finding page controls"],
  ["browser_snapshot", "Inspecting the page"],
  ["browser_text", "Reading the page"],
  ["capture_browser_image", "Capturing browser evidence"],
  ["computer_action", "Using visual browser controls"],
  ["fill_from_vault", "Securely filling saved user information"],
  ["list_vault", "Checking saved user information"],
  ["load_skill", "Loading the browser procedure"],
  ["manage_browsers", "Starting the browser"],
  ["playwright_execute", "Interacting with the page"],
  ["web_fetch", "Reading a public source"],
  ["web_search", "Searching for live options"],
]);

const managedBrowserOutputSchema = z.object({
  browser: z.object({ browser_live_view_url: z.url() }),
});

type ActionsRequested = Extract<
  MessageStreamEvent,
  { type: "actions.requested" }
>;

type ActionItem = ActionsRequested["data"]["actions"][number];

function joinedTurnMessage(
  events: readonly MessageStreamEvent[],
  turnId: string,
  stepIndex: number
) {
  return events
    .flatMap((candidate) => {
      if (candidate.type !== "message.appended") return [];

      if (candidate.data.turnId !== turnId) return [];

      if (candidate.data.stepIndex !== stepIndex) return [];

      return [candidate.data.messageDelta];
    })
    .join("");
}

function activityFromAppended(
  event: Extract<MessageStreamEvent, { type: "message.appended" }>,
  events: readonly MessageStreamEvent[]
) {
  return activityLine(
    joinedTurnMessage(events, event.data.turnId, event.data.stepIndex)
  );
}

function activityFromCompleted(
  event: Extract<MessageStreamEvent, { type: "message.completed" }>
) {
  return activityLine(event.data.message ?? "");
}

function activityLabelForAction(action: ActionItem) {
  if (action.kind === "load-skill") return "Loading the browser procedure";

  if (action.kind === "tool-call") return activityForTool(action.toolName);

  return "Coordinating browser work";
}

function activityFromActionsRequested(event: ActionsRequested) {
  const activities = event.data.actions.map(activityLabelForAction);

  return [...new Set(activities)].join(" and ");
}

function activityFromActionResult(
  event: Extract<MessageStreamEvent, { type: "action.result" }>
) {
  const result = event.data.result;

  if (result.kind !== "tool-result") return null;

  return `Reviewing ${activityForTool(result.toolName).toLowerCase()} result`;
}

function activityFromEvent(
  event: MessageStreamEvent,
  events: readonly MessageStreamEvent[]
): string | null {
  if (event.type === "message.appended") {
    return activityFromAppended(event, events);
  }

  if (event.type === "message.completed") {
    return activityFromCompleted(event);
  }

  if (event.type === "actions.requested") {
    return activityFromActionsRequested(event);
  }

  if (event.type === "action.result") {
    return activityFromActionResult(event);
  }

  if (event.type === "input.requested") return "Waiting for required input";

  if (event.type === "step.started") return "Planning the next step";

  return null;
}

export function browserBenchmarkActivity(
  events: readonly MessageStreamEvent[]
) {
  for (const event of events.toReversed()) {
    const message = activityFromEvent(event, events);

    if (message) return message;
  }

  return null;
}

export function browserBenchmarkActivityDurations(
  events: readonly MessageStreamEvent[],
  now = Date.now()
) {
  return sumBrowserActivityDurations(
    events.flatMap((event) => {
      const kind = activityKindForEvent(event);

      return kind ? [{ at: Date.parse(event.meta.at), kind }] : [];
    }),
    now
  );
}

function liveViewUrlFromParsed(
  parsed: ReturnType<typeof managedBrowserOutputSchema.safeParse>
) {
  if (!parsed.success) return null;

  try {
    const url = new URL(parsed.data.browser.browser_live_view_url);

    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function liveViewUrlFromEvent(event: MessageStreamEvent) {
  if (event.type !== "action.result") return null;
  const result = event.data.result;

  if (result.kind !== "tool-result") return null;

  if (result.toolName !== "manage_browsers") return null;

  return liveViewUrlFromParsed(
    managedBrowserOutputSchema.safeParse(result.output)
  );
}

export function browserBenchmarkLiveViewUrl(
  events: readonly MessageStreamEvent[]
) {
  for (const event of events.toReversed()) {
    const url = liveViewUrlFromEvent(event);

    if (url) return url;
  }

  return null;
}

const modelActivityEventTypes = new Set([
  "step.started",
  "message.appended",
  "message.completed",
  "action.result",
]);

function activityKindForAction(
  action: ActionItem
): BrowserActivityKind | "other" {
  if (action.kind === "load-skill") {
    return "setup";
  }

  if (action.kind === "tool-call") {
    return browserActivityKindForTool(action.toolName);
  }

  return "other";
}

function requestedActionsActivityKind(event: ActionsRequested) {
  const kinds = new Set(event.data.actions.map(activityKindForAction));

  if (kinds.size !== 1) {
    return "other";
  }

  return kinds.values().next().value ?? "other";
}

function activityKindForEvent(
  event: MessageStreamEvent
): BrowserActivityKind | null {
  if (modelActivityEventTypes.has(event.type)) {
    return "model";
  }

  if (event.type === "input.requested") {
    return "waiting";
  }

  if (event.type !== "actions.requested") {
    return null;
  }

  return requestedActionsActivityKind(event);
}

function activityForTool(name: string) {
  return toolActivity.get(name) ?? `Running ${name.replaceAll("_", " ")}`;
}

function activityLine(value: string) {
  const line = value.replaceAll(/\s+/gu, " ").trim();

  if (!line) return null;

  return line.length > 180 ? `${line.slice(0, 179).trimEnd()}…` : line;
}
