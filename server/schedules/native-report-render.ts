import type { InputRequest } from "eve/client";

import type { ScheduledRunOutcome } from "../../shared/schedules/outcome";

export function renderNativeReport(input: {
  readonly prompt: string;
  readonly outcome: ScheduledRunOutcome | null;
  readonly pendingInputRequests: readonly InputRequest[] | null;
}) {
  if (input.pendingInputRequests) {
    const points = Array.from(input.prompt.toWellFormed());
    const task = `${points.slice(0, 500).join("")}${points.length > 500 ? "…" : ""}`;

    const message = [
      `Your scheduled task needs a response: ${task}`,
      ...input.pendingInputRequests.map((request) =>
        [
          request.prompt,
          ...(request.options ?? []).map(
            (option) =>
              `${option.label}${option.description ? ` — ${option.description}` : ""}`
          ),
        ].join("\n")
      ),
      "Reply in this conversation with your answer and the task you are answering. I can find the waiting run in your schedules.",
    ].join("\n\n");

    if (message.length <= 16_384 && message.isWellFormed()) return message;

    return `Your scheduled task needs more information: ${task}\n\nThe full request cannot fit in this message. Ask me to review the waiting task in this conversation before answering.`;
  }

  const outcome = input.outcome;

  if (!outcome || outcome.kind === "nothing_to_report") return null;

  if (outcome.kind === "blocked")
    return `${outcome.summary}\n\nAction needed: ${outcome.userActionNeeded}`.toWellFormed();

  return [
    outcome.summary,
    outcome.details,
    ...(outcome.artifacts ?? []).map(
      (artifact) =>
        `Saved artifact: ${artifact.label ?? artifact.id}. Ask me to open it.`
    ),
  ]
    .filter(Boolean)
    .join("\n\n")
    .toWellFormed();
}

export function nativeReportReceiptStatus(statuses: readonly string[]) {
  if (statuses.includes("uncertain")) return "uncertain";

  if (statuses.includes("dispatching") || statuses.includes("queued"))
    return "queued";

  if (statuses.includes("failed")) return "failed";

  if (statuses.includes("cancelled")) return "cancelled";

  if (statuses.length > 0 && statuses.every((status) => status === "sent"))
    return "delivered";

  return "queued";
}

export function nativeReportOutputSetComplete(
  bindings: readonly {
    readonly chunkIndex: number;
    readonly outboxId: string;
  }[],
  chunks: readonly { readonly id: string; readonly key: string }[],
  prefix: string
) {
  return (
    bindings.length > 0 &&
    bindings.length === chunks.length &&
    bindings.every(
      (binding, index) =>
        binding.chunkIndex === index &&
        chunks.some(
          (chunk) =>
            chunk.id === binding.outboxId &&
            chunk.key === `${prefix}${String(index)}`
        )
    )
  );
}
