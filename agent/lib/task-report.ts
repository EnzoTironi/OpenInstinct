import { createHash } from "node:crypto";
import { defineState } from "eve/context";
import type { ToolContext } from "eve/tools";
import type { sendMessageOutputSchema } from "../../shared/chat/message-delivery";

const deliveredReports = defineState<Readonly<Record<string, string>>>(
  "companion.deliveredTaskReports",
  () => ({})
);

export function taskReportDeliveryId(context: Pick<ToolContext, "session">) {
  const report = context.session.taskReport;
  if (context.session.parent || !report) return undefined;
  const hash = createHash("sha256")
    .update(JSON.stringify([context.session.id, report.cohortId]))
    .digest("hex");
  return `task-report:${hash}`;
}

export function deliverWebTaskReport(
  message: typeof sendMessageOutputSchema.Type,
  context: Pick<ToolContext, "session" | "callId">
) {
  const deliveryId = taskReportDeliveryId(context);
  if (!deliveryId) return message;
  if (deliveredReports.get()[deliveryId]) {
    return { kind: "task-report-receipt" as const, deliveryId };
  }
  deliveredReports.update((current) => ({
    ...current,
    [deliveryId]: context.callId,
  }));
  return { ...message, deliveryId };
}
