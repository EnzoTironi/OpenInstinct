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

export type TraceView = "imessage" | "trace";

export function messagesForTraceView(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[],
  traceView: TraceView
) {
  if (traceView === "trace") return messages;
  const hiddenMessageIds = backgroundWorkerDeliveryMessageIds(events);
  return messages.filter((message) => !hiddenMessageIds.has(message.id));
}

export function backgroundWorkerDeliveryMessageIds(
  events: readonly MessageStreamEvent[]
) {
  // The runtime marks task-origin messages; user text cannot supply that provenance.
  const cancelledTaskIds = new Set<string>();
  const messageIds = new Set<string>();

  for (const event of events) {
    if (event.type === "action.result") {
      const result = taskCancelResultSchema.safeParse(event.data.result);
      if (!result.success) continue;
      for (const value of result.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) cancelledTaskIds.add(task.data.taskId);
      }
      continue;
    }

    if (event.type !== "message.received" || event.data.source !== "task")
      continue;
    const taskId = deliveredTaskId(event.data.message);
    if (taskId) {
      const isCancellation =
        /\((?:browser-agent|agent)\) is cancelled\.$/u.test(event.data.message);
      messageIds.add(`${event.data.turnId}:user`);
      if (isCancellation && cancelledTaskIds.delete(taskId)) {
        messageIds.add(`${event.data.turnId}:user`);
        messageIds.add(`${event.data.turnId}:assistant`);
      }
    }
  }

  return messageIds;
}

export function hasPendingBackgroundWorker(
  events: readonly MessageStreamEvent[]
) {
  const taskIds = new Set<string>();

  for (const event of events) {
    const accepted = genericTaskReceipt(event);
    if (accepted) {
      taskIds.add(accepted);
      continue;
    }

    if (
      event.type === "subagent.completed" &&
      ["browser-agent", "agent"].includes(event.data.subagentName) &&
      event.data.backgroundTask !== undefined
    ) {
      taskIds.add(event.data.backgroundTask.taskId);
      continue;
    }

    if (event.type === "action.result") {
      const result = event.data.result;
      if (
        result.kind === "subagent-result" &&
        ["browser-agent", "agent"].includes(result.subagentName) &&
        result.origin === "child" &&
        result.backgroundTask !== undefined
      ) {
        taskIds.add(result.backgroundTask.taskId);
        continue;
      }

      const cancellation = taskCancelResultSchema.safeParse(result);
      if (!cancellation.success) continue;
      for (const value of cancellation.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) taskIds.delete(task.data.taskId);
      }
      continue;
    }

    if (event.type !== "message.received" || event.data.source !== "task")
      continue;
    const taskId = deliveredTaskId(event.data.message);
    if (
      taskId &&
      /^Background task \S+ \((?:browser-agent|agent)\) (?:is cancelled\.$|is completed\.\n\nResult:\n|failed\.\n\nError:\n)/u.test(
        event.data.message
      )
    ) {
      taskIds.delete(taskId);
    }
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
  if (event.type !== "action.result" || event.data.status !== "completed")
    return undefined;
  const receipt = genericTaskReceiptSchema.safeParse(event.data.result);
  return receipt.success ? receipt.data.output.taskId : undefined;
}
