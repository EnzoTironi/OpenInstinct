import type { InputRequest } from "eve/client";

import type { ScheduledRunOutcome } from "../../shared/schedules/outcome";

function truncateTask(prompt: string) {
  const points = Array.from(prompt.toWellFormed());

  if (points.length > 500) return `${points.slice(0, 500).join("")}…`;

  return points.join("");
}

function formatInputOption(option: {
  readonly label: string;
  readonly description?: string;
}) {
  if (option.description) return `${option.label} — ${option.description}`;

  return option.label;
}

function formatInputRequest(request: InputRequest) {
  return [
    request.prompt,
    ...(request.options ?? []).map(formatInputOption),
  ].join("\n");
}

function renderPendingInputReport(
  prompt: string,
  requests: readonly InputRequest[]
) {
  const task = truncateTask(prompt);

  const message = [
    `Your scheduled task needs a response: ${task}`,
    ...requests.map(formatInputRequest),
    "Reply in this conversation with your answer and the task you are answering. I can find the waiting run in your schedules.",
  ].join("\n\n");

  if (message.length <= 16_384 && message.isWellFormed()) return message;

  return `Your scheduled task needs more information: ${task}\n\nThe full request cannot fit in this message. Ask me to review the waiting task in this conversation before answering.`;
}

function formatArtifactLine(artifact: {
  readonly id: string;
  readonly label?: string | null;
}) {
  return `Saved artifact: ${artifact.label ?? artifact.id}. Ask me to open it.`;
}

function renderOutcomeReport(outcome: ScheduledRunOutcome) {
  if (outcome.kind === "nothing_to_report") return null;

  if (outcome.kind === "blocked") {
    return `${outcome.summary}\n\nAction needed: ${outcome.userActionNeeded}`.toWellFormed();
  }

  return [
    outcome.summary,
    outcome.details,
    ...(outcome.artifacts ?? []).map(formatArtifactLine),
  ]
    .filter(Boolean)
    .join("\n\n")
    .toWellFormed();
}

export function renderNativeReport(input: {
  readonly prompt: string;
  readonly outcome: ScheduledRunOutcome | null;
  readonly pendingInputRequests: readonly InputRequest[] | null;
}) {
  if (input.pendingInputRequests) {
    return renderPendingInputReport(input.prompt, input.pendingInputRequests);
  }

  if (!input.outcome) return null;

  return renderOutcomeReport(input.outcome);
}

function allStatusesSent(statuses: readonly string[]) {
  return statuses.length > 0 && statuses.every((status) => status === "sent");
}

export function nativeReportReceiptStatus(statuses: readonly string[]) {
  if (statuses.includes("uncertain")) return "uncertain";

  if (statuses.includes("dispatching")) return "queued";

  if (statuses.includes("queued")) return "queued";

  if (statuses.includes("failed")) return "failed";

  if (statuses.includes("cancelled")) return "cancelled";

  if (allStatusesSent(statuses)) return "delivered";

  return "queued";
}

function bindingMatchesChunk(
  binding: { readonly chunkIndex: number; readonly outboxId: string },
  index: number,
  chunks: readonly { readonly id: string; readonly key: string }[],
  prefix: string
) {
  if (binding.chunkIndex !== index) return false;

  return chunks.some(
    (chunk) =>
      chunk.id === binding.outboxId && chunk.key === `${prefix}${String(index)}`
  );
}

export function nativeReportOutputSetComplete(
  bindings: readonly {
    readonly chunkIndex: number;
    readonly outboxId: string;
  }[],
  chunks: readonly { readonly id: string; readonly key: string }[],
  prefix: string
) {
  if (bindings.length === 0) return false;

  if (bindings.length !== chunks.length) return false;

  return bindings.every((binding, index) =>
    bindingMatchesChunk(binding, index, chunks, prefix)
  );
}
