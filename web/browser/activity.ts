export const browserActivityKinds = [
  "model",
  "playwright",
  "semantic",
  "visual",
  "web",
  "vault",
  "setup",
  "waiting",
  "other",
] as const;

export type BrowserActivityKind = (typeof browserActivityKinds)[number];

export type BrowserActivityDurations = Partial<
  Record<BrowserActivityKind, number>
>;

const toolActivityKind = new Map<string, BrowserActivityKind>([
  ["browser_act", "semantic"],
  ["browser_find", "semantic"],
  ["browser_snapshot", "semantic"],
  ["browser_text", "semantic"],
  ["browser_wait_for", "semantic"],
  ["capture_browser_image", "visual"],
  ["computer_action", "visual"],
  ["fill_from_vault", "vault"],
  ["list_vault", "vault"],
  ["load_skill", "setup"],
  ["manage_browsers", "setup"],
  ["playwright_execute", "playwright"],
  ["web_fetch", "web"],
  ["web_search", "web"],
]);

export function browserActivityKindForTool(name: string): BrowserActivityKind {
  return toolActivityKind.get(name) ?? "other";
}

export function browserTraceActivityDurations(
  events: readonly {
    readonly at: string;
    readonly label: string;
    readonly type: string;
  }[],
  now = Date.now()
) {
  return sumBrowserActivityDurations(
    events.flatMap((event) => {
      const kind = browserTraceActivityKind(event);

      return kind ? [{ at: Date.parse(event.at), kind }] : [];
    }),
    now
  );
}

export function sumBrowserActivityDurations(
  points: readonly {
    readonly at: number;
    readonly kind: BrowserActivityKind;
  }[],
  now = Date.now()
) {
  const durations: BrowserActivityDurations = {};
  let current: (typeof points)[number] | null = null;

  for (const point of points) {
    if (!Number.isFinite(point.at)) continue;

    if (current) {
      addDuration(durations, current.kind, Math.max(0, point.at - current.at));
    }

    current = point;
  }

  if (current) {
    addDuration(durations, current.kind, Math.max(0, now - current.at));
  }

  return durations;
}

const waitingActivityTypes = new Set([
  "input.requested",
  "authorization.required",
]);

const modelActivityTypes = new Set([
  "message.received",
  "message.completed",
  "action.result",
  "input.resolved",
  "authorization.completed",
  "result.completed",
]);

function actionsRequestedActivityKind(label: string): BrowserActivityKind {
  if (label === "Load skill") {
    return "setup";
  }

  return browserActivityKindForTool(label);
}

function browserTraceActivityKind(event: {
  readonly label: string;
  readonly type: string;
}): BrowserActivityKind | null {
  if (event.type === "actions.requested") {
    return actionsRequestedActivityKind(event.label);
  }

  if (waitingActivityTypes.has(event.type)) {
    return "waiting";
  }

  if (modelActivityTypes.has(event.type)) {
    return "model";
  }

  return null;
}

function addDuration(
  durations: BrowserActivityDurations,
  kind: BrowserActivityKind,
  durationMs: number
) {
  if (durationMs === 0) return;
  durations[kind] = Math.round((durations[kind] ?? 0) + durationMs);
}
