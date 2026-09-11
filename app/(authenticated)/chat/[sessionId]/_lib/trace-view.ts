import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { z } from "zod";

const backgroundWorkerDelivery =
  /^Background task (\S+) \((?:browser-agent|agent)\) (?:update: |needs input\.$|is cancelled\.$|is completed\.\n\nResult:\n|failed\.\n\nError:\n)/u;

const backgroundWorkerAuthorization =
  /^Background task (\S+) needs authorization\.$/u;

const taskCancelResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: z.object({ tasks: z.array(z.unknown()) }),
  toolName: z.literal("task_cancel"),
});

const cancelledWorkerTaskSchema = z.object({
  metadata: z.object({ name: z.enum(["browser-agent", "agent"]) }),
  status: z.literal("cancelled"),
  taskId: z.string(),
});

const workerChildSubagentResultSchema = z.object({
  backgroundTask: z.object({ taskId: z.string() }),
  kind: z.literal("subagent-result"),
  origin: z.literal("child"),
  subagentName: z.enum(["browser-agent", "agent"]),
});

const workerAgentNames = new Set(["browser-agent", "agent"]);

const terminalBackgroundDelivery =
  /^Background task \S+ \((?:browser-agent|agent)\) (?:is cancelled\.$|is completed\.\n\nResult:\n|failed\.\n\nError:\n)/u;

const cancelledBackgroundDelivery =
  /\((?:browser-agent|agent)\) is cancelled\.$/u;

export type TraceView = "imessage" | "trace";

export function messagesForTraceView(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[],
  traceView: TraceView
) {
  if (traceView === "trace") {
    return messages;
  }

  const hiddenMessageIds = backgroundWorkerDeliveryMessageIds(events);

  return messages.filter((message) => !hiddenMessageIds.has(message.id));
}

function collectCancelledTaskIds(
  event: MessageStreamEvent,
  cancelledTaskIds: Set<string>
) {
  if (event.type !== "action.result") {
    return false;
  }

  const result = taskCancelResultSchema.safeParse(event.data.result);

  if (!result.success) {
    return true;
  }

  for (const value of result.data.output.tasks) {
    const task = cancelledWorkerTaskSchema.safeParse(value);

    if (task.success) {
      cancelledTaskIds.add(task.data.taskId);
    }
  }

  return true;
}

function hideTaskDeliveryMessage(
  event: MessageStreamEvent,
  cancelledTaskIds: Set<string>,
  messageIds: Set<string>
) {
  if (event.type !== "message.received" || event.data.source !== "task") {
    return;
  }

  const taskId = deliveredTaskId(event.data.message);

  if (!taskId) {
    return;
  }

  messageIds.add(`${event.data.turnId}:user`);

  const isCancellation = cancelledBackgroundDelivery.test(event.data.message);

  if (isCancellation && cancelledTaskIds.delete(taskId)) {
    messageIds.add(`${event.data.turnId}:user`);
    messageIds.add(`${event.data.turnId}:assistant`);
  }
}

export function backgroundWorkerDeliveryMessageIds(
  events: readonly MessageStreamEvent[]
) {
  // The runtime marks task-origin messages; user text cannot supply that provenance.
  const cancelledTaskIds = new Set<string>();
  const messageIds = new Set<string>();

  for (const event of events) {
    if (collectCancelledTaskIds(event, cancelledTaskIds)) {
      continue;
    }

    hideTaskDeliveryMessage(event, cancelledTaskIds, messageIds);
  }

  return messageIds;
}

function addAcceptedTaskId(
  event: MessageStreamEvent,
  taskIds: Set<string>
): boolean {
  const accepted = genericTaskReceipt(event);

  if (!accepted) {
    return false;
  }

  taskIds.add(accepted);

  return true;
}

function addCompletedSubagentTask(
  event: MessageStreamEvent,
  taskIds: Set<string>
): boolean {
  if (event.type !== "subagent.completed") {
    return false;
  }

  if (!workerAgentNames.has(event.data.subagentName)) {
    return false;
  }

  if (event.data.backgroundTask === undefined) {
    return false;
  }

  taskIds.add(event.data.backgroundTask.taskId);

  return true;
}

function addChildSubagentResultTask(
  event: Extract<MessageStreamEvent, { type: "action.result" }>,
  taskIds: Set<string>
): boolean {
  const parsed = workerChildSubagentResultSchema.safeParse(event.data.result);

  if (!parsed.success) {
    return false;
  }

  taskIds.add(parsed.data.backgroundTask.taskId);

  return true;
}

function removeCancelledTasksFromAction(
  event: Extract<MessageStreamEvent, { type: "action.result" }>,
  taskIds: Set<string>
) {
  const cancellation = taskCancelResultSchema.safeParse(event.data.result);

  if (!cancellation.success) {
    return;
  }

  for (const value of cancellation.data.output.tasks) {
    const task = cancelledWorkerTaskSchema.safeParse(value);

    if (task.success) {
      taskIds.delete(task.data.taskId);
    }
  }
}

function handleActionResultForPending(
  event: MessageStreamEvent,
  taskIds: Set<string>
): boolean {
  if (event.type !== "action.result") {
    return false;
  }

  if (addChildSubagentResultTask(event, taskIds)) {
    return true;
  }

  removeCancelledTasksFromAction(event, taskIds);

  return true;
}

function removeTerminalDelivery(
  event: MessageStreamEvent,
  taskIds: Set<string>
) {
  if (event.type !== "message.received" || event.data.source !== "task") {
    return;
  }

  const taskId = deliveredTaskId(event.data.message);

  if (!taskId) {
    return;
  }

  if (!terminalBackgroundDelivery.test(event.data.message)) {
    return;
  }

  taskIds.delete(taskId);
}

function applyPendingWorkerEvent(
  event: MessageStreamEvent,
  taskIds: Set<string>
) {
  if (addAcceptedTaskId(event, taskIds)) {
    return;
  }

  if (addCompletedSubagentTask(event, taskIds)) {
    return;
  }

  if (handleActionResultForPending(event, taskIds)) {
    return;
  }

  removeTerminalDelivery(event, taskIds);
}

export function hasPendingBackgroundWorker(
  events: readonly MessageStreamEvent[]
) {
  const taskIds = new Set<string>();

  for (const event of events) {
    applyPendingWorkerEvent(event, taskIds);
  }

  return taskIds.size > 0;
}

function deliveredTaskId(message: string) {
  return (
    backgroundWorkerDelivery.exec(message)?.[1] ??
    backgroundWorkerAuthorization.exec(message)?.[1]
  );
}

const genericTaskReceiptSchema = z.object({
  kind: z.literal("tool-result"),
  toolName: z.literal("agent"),
  output: z.object({ status: z.literal("working"), taskId: z.string() }),
});

function genericTaskReceipt(event: MessageStreamEvent) {
  if (event.type !== "action.result" || event.data.status !== "completed") {
    return undefined;
  }

  const receipt = genericTaskReceiptSchema.safeParse(event.data.result);

  return receipt.success ? receipt.data.output.taskId : undefined;
}
