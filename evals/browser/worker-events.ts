import { taskCompletionOutputSchema } from "@agent/subagents/browser-agent/lib/completion";
import type { MessageStreamEvent } from "eve/client";
import { z } from "zod";

const workerTaskNotificationPrefix =
  /^Background task (\S+) \(browser-agent\) /u;

const terminalTaskControlSchema = z.object({
  tasks: z.array(
    z.object({
      status: z.enum(["cancelled", "completed", "failed"]),
      taskId: z.string(),
    })
  ),
});

interface BackgroundWorkerTaskState {
  output?: string;
  status?: "cancelled" | "completed" | "failed";
  taskId: string;
  terminalAt?: string;
}

type TaskCompletion = ReturnType<typeof taskCompletionOutputSchema.parse> & {
  completedAt: string;
};

function isMessageReceived(
  event: MessageStreamEvent
): event is Extract<MessageStreamEvent, { type: "message.received" }> {
  return event.type === "message.received";
}

function isPendingWorkerTask(task: BackgroundWorkerTaskState) {
  return task.status === undefined;
}

function hasPendingWorker(tasks: readonly BackgroundWorkerTaskState[]) {
  return tasks.some(isPendingWorkerTask);
}

function lastTerminalAt(tasks: readonly BackgroundWorkerTaskState[]) {
  return tasks.findLast((task) => task.terminalAt)?.terminalAt;
}

function isTerminalFailureEvent(
  event: MessageStreamEvent,
  pendingWorker: boolean
) {
  if (event.type === "session.failed") return true;

  if (pendingWorker) return false;

  return event.type === "turn.failed" || event.type === "turn.cancelled";
}

function findTerminalAt(
  events: readonly MessageStreamEvent[],
  backgroundTasks: readonly BackgroundWorkerTaskState[]
) {
  const completionAt = readTaskCompletion(events)?.completedAt;

  if (completionAt) return completionAt;

  const pendingWorker = hasPendingWorker(backgroundTasks);

  if (!pendingWorker) {
    const fromTasks = lastTerminalAt(backgroundTasks);

    if (fromTasks) return fromTasks;
  }

  return events.findLast((event) =>
    isTerminalFailureEvent(event, pendingWorker)
  )?.meta.at;
}

interface StepUsageTotals {
  completedSteps: number;
  measuredSteps: number;
  costUsd: number;
  measuredInputTokenSteps: number;
  measuredOutputTokenSteps: number;
  inputTokens: number;
  outputTokens: number;
}

function addCostUsage(totals: StepUsageTotals, cost: number | undefined) {
  if (cost === undefined) return;
  totals.measuredSteps += 1;
  totals.costUsd += cost;
}

function addInputUsage(totals: StepUsageTotals, input: number | undefined) {
  if (input === undefined) return;
  totals.measuredInputTokenSteps += 1;
  totals.inputTokens += input;
}

function addOutputUsage(totals: StepUsageTotals, output: number | undefined) {
  if (output === undefined) return;
  totals.measuredOutputTokenSteps += 1;
  totals.outputTokens += output;
}

function accumulateStepUsage(
  events: readonly MessageStreamEvent[],
  totals: StepUsageTotals
) {
  for (const event of events) {
    if (event.type !== "step.completed") continue;
    totals.completedSteps += 1;
    addCostUsage(totals, event.data.usage?.costUsd);
    addInputUsage(totals, event.data.usage?.inputTokens);
    addOutputUsage(totals, event.data.usage?.outputTokens);
  }
}

export function measureWorkerTask(
  events: readonly MessageStreamEvent[],
  fallbackDurationMs: number
) {
  const start = events.find(isMessageReceived)?.meta.at;
  const backgroundTasks = readBackgroundWorkerTasks(events);
  const terminal = findTerminalAt(events, backgroundTasks);

  const totals = {
    completedSteps: 0,
    measuredSteps: 0,
    costUsd: 0,
    measuredInputTokenSteps: 0,
    measuredOutputTokenSteps: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  accumulateStepUsage(events, totals);

  const durationMs =
    start && terminal
      ? elapsedMs(start, terminal)
      : Math.max(0, fallbackDurationMs);

  return {
    costComplete:
      totals.completedSteps > 0 &&
      totals.measuredSteps === totals.completedSteps,
    costUsd: totals.measuredSteps === 0 ? null : totals.costUsd,
    durationMs,
    inputTokens:
      totals.measuredInputTokenSteps === 0 ? null : totals.inputTokens,
    modelSteps: totals.completedSteps,
    outputTokens:
      totals.measuredOutputTokenSteps === 0 ? null : totals.outputTokens,
  };
}

export function didCompleteWorker(events: readonly MessageStreamEvent[]) {
  return readTaskCompletion(events)?.status === "success";
}

export function didFinishWorker(events: readonly MessageStreamEvent[]) {
  const backgroundTasks = readBackgroundWorkerTasks(events);

  if (backgroundTasks.length > 0) {
    return backgroundTasks.every((task) => task.status !== undefined);
  }

  return readTaskCompletion(events) !== undefined;
}

function isTurnOrSessionFailed(event: MessageStreamEvent) {
  return event.type === "turn.failed" || event.type === "session.failed";
}

export function terminalWorkerMessage(
  message: string | undefined,
  events: readonly MessageStreamEvent[]
) {
  const completion = readTaskCompletion(events);

  if (completion) return normalizeMessage(completion.message);

  if (message?.trim()) return normalizeMessage(message);

  const failure = events.findLast(isTurnOrSessionFailed);

  if (failure) return normalizeMessage(failure.data.message);

  return "No terminal message";
}

function completionFromParsed(
  completion: ReturnType<typeof taskCompletionOutputSchema.safeParse>,
  completedAt: string
): TaskCompletion | undefined {
  if (!completion.success) return undefined;

  return { ...completion.data, completedAt };
}

function completionFromBackgroundTasks(
  backgroundTasks: readonly BackgroundWorkerTaskState[]
): TaskCompletion | undefined {
  if (hasPendingWorker(backgroundTasks)) return undefined;

  const latest = backgroundTasks.at(-1);

  if (latest?.status !== "completed") return undefined;

  if (!latest.output || !latest.terminalAt) return undefined;

  return completionFromParsed(
    taskCompletionOutputSchema.safeParse(latest.output),
    latest.terminalAt
  );
}

function completionFromResultCompleted(
  event: Extract<MessageStreamEvent, { type: "result.completed" }>
) {
  return completionFromParsed(
    taskCompletionOutputSchema.safeParse(event.data.result),
    event.meta.at
  );
}

function completionFromSubagentCompleted(
  event: Extract<MessageStreamEvent, { type: "subagent.completed" }>
) {
  if (event.data.subagentName !== "browser-agent") return undefined;

  if (event.data.backgroundTask !== undefined) return undefined;

  return completionFromParsed(
    taskCompletionOutputSchema.safeParse(event.data.output),
    event.meta.at
  );
}

function isBrowserAgentChildResult(
  result: Extract<
    MessageStreamEvent,
    { type: "action.result" }
  >["data"]["result"] & { kind: "subagent-result" }
) {
  if (result.subagentName !== "browser-agent") return false;

  if (result.origin !== "child") return true;

  return result.backgroundTask === undefined;
}

function completionFromActionResult(
  event: Extract<MessageStreamEvent, { type: "action.result" }>
) {
  if (event.data.status !== "completed") return undefined;

  const result = event.data.result;

  if (result.kind !== "subagent-result") return undefined;

  if (!isBrowserAgentChildResult(result)) return undefined;

  return completionFromParsed(
    taskCompletionOutputSchema.safeParse(result.output),
    event.meta.at
  );
}

function completionFromEvent(
  event: MessageStreamEvent
): TaskCompletion | undefined {
  if (event.type === "result.completed") {
    return completionFromResultCompleted(event);
  }

  if (event.type === "subagent.completed") {
    return completionFromSubagentCompleted(event);
  }

  if (event.type === "action.result") {
    return completionFromActionResult(event);
  }

  return undefined;
}

export function readTaskCompletion(events: readonly MessageStreamEvent[]) {
  const backgroundTasks = readBackgroundWorkerTasks(events);

  if (backgroundTasks.length > 0) {
    return completionFromBackgroundTasks(backgroundTasks);
  }

  for (const event of events.toReversed()) {
    const completion = completionFromEvent(event);

    if (completion) return completion;
  }

  return undefined;
}

function readWorkerTaskNotification(event: MessageStreamEvent) {
  if (event.type !== "message.received") return undefined;
  const match = workerTaskNotificationPrefix.exec(event.data.message);

  if (!match) return undefined;
  const [, taskId] = match;

  if (!taskId) return undefined;
  const message = event.data.message.slice(match[0].length);

  if (message === "is cancelled.")
    return { status: "cancelled" as const, taskId };

  const completedPrefix = "is completed.\n\nResult:\n";

  if (message.startsWith(completedPrefix)) {
    return {
      output: message.slice(completedPrefix.length),
      status: "completed" as const,
      taskId,
    };
  }

  const failedPrefix = "failed.\n\nError:\n";

  if (message.startsWith(failedPrefix)) {
    return {
      output: message.slice(failedPrefix.length),
      status: "failed" as const,
      taskId,
    };
  }

  return undefined;
}

function applyReceipt(
  tasks: Map<string, BackgroundWorkerTaskState>,
  event: MessageStreamEvent
) {
  const receiptTaskId = readBackgroundWorkerReceiptTaskId(event);

  if (!receiptTaskId) return false;

  tasks.set(receiptTaskId, { taskId: receiptTaskId });

  return true;
}

function applyNotification(
  tasks: Map<string, BackgroundWorkerTaskState>,
  event: MessageStreamEvent
) {
  const notification = readWorkerTaskNotification(event);

  if (!notification) return false;

  const task = tasks.get(notification.taskId);

  if (task) {
    tasks.set(notification.taskId, {
      ...task,
      output: notification.output,
      status: notification.status,
      terminalAt: event.meta.at,
    });
  }

  return true;
}

function isTaskCancelResult(event: MessageStreamEvent) {
  if (event.type !== "action.result") return false;

  if (event.data.status !== "completed") return false;

  if (event.data.result.kind !== "tool-result") return false;

  return event.data.result.toolName === "task_cancel";
}

function taskCancelOutput(event: MessageStreamEvent) {
  if (event.type !== "action.result") return undefined;

  if (event.data.result.kind !== "tool-result") return undefined;

  return event.data.result.output;
}

function markTaskTerminal(
  tasks: Map<string, BackgroundWorkerTaskState>,
  taskId: string,
  status: "cancelled" | "completed" | "failed",
  terminalAt: string
) {
  const task = tasks.get(taskId);

  if (!task) return;
  tasks.set(taskId, { ...task, status, terminalAt });
}

function applyTaskCancel(
  tasks: Map<string, BackgroundWorkerTaskState>,
  event: MessageStreamEvent
) {
  if (!isTaskCancelResult(event)) return;

  const parsed = terminalTaskControlSchema.safeParse(taskCancelOutput(event));

  if (!parsed.success) return;

  for (const result of parsed.data.tasks) {
    markTaskTerminal(tasks, result.taskId, result.status, event.meta.at);
  }
}

function readBackgroundWorkerTasks(events: readonly MessageStreamEvent[]) {
  const tasks = new Map<string, BackgroundWorkerTaskState>();

  for (const event of events) {
    if (applyReceipt(tasks, event)) continue;

    if (applyNotification(tasks, event)) continue;
    applyTaskCancel(tasks, event);
  }

  return [...tasks.values()];
}

function readBackgroundWorkerReceiptTaskId(event: MessageStreamEvent) {
  if (
    event.type === "subagent.completed" &&
    event.data.subagentName === "browser-agent" &&
    event.data.backgroundTask !== undefined
  ) {
    return event.data.backgroundTask.taskId;
  }

  if (
    event.type === "action.result" &&
    event.data.result.kind === "subagent-result" &&
    event.data.result.subagentName === "browser-agent" &&
    event.data.result.origin === "child" &&
    event.data.result.backgroundTask !== undefined
  ) {
    return event.data.result.backgroundTask.taskId;
  }

  return undefined;
}

function elapsedMs(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function normalizeMessage(message: string) {
  return message.replaceAll(/\s+/gu, " ").trim();
}
