import type { ChatUsage } from "@shared/chat/schema";
import type { MessageStreamEvent } from "eve/client";

export function summarizeChatUsage(
  events: readonly MessageStreamEvent[]
): ChatUsage {
  let costUsd = 0;
  let completedSteps = 0;
  let measuredCosts = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of events) {
    if (event.type !== "step.completed") continue;
    completedSteps += 1;

    inputTokens += event.data.usage?.inputTokens ?? 0;
    outputTokens += event.data.usage?.outputTokens ?? 0;

    if (event.data.usage?.costUsd !== undefined) {
      costUsd += event.data.usage.costUsd;
      measuredCosts += 1;
    }
  }

  return {
    costUsd:
      completedSteps > 0 && measuredCosts === completedSteps ? costUsd : null,
    inputTokens,
    outputTokens,
  };
}

export function combineChatUsage(usages: readonly ChatUsage[]): ChatUsage {
  let costUsd = 0;
  let hasMeasuredCost = false;
  let hasUnmeasuredUsage = false;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const usage of usages) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;

    if (usage.costUsd === null) {
      hasUnmeasuredUsage ||= usage.inputTokens + usage.outputTokens > 0;
    } else {
      costUsd += usage.costUsd;
      hasMeasuredCost = true;
    }
  }

  return {
    costUsd: hasMeasuredCost && !hasUnmeasuredUsage ? costUsd : null,
    inputTokens,
    outputTokens,
  };
}

const tokenCountFormatterCompact = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  notation: "compact",
});

const tokenCountFormatterStandard = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  notation: "standard",
});

const costFormatterCents = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const costFormatterFractions = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
  style: "currency",
});

export function formatChatUsage(usage: ChatUsage) {
  const tokens = usage.inputTokens + usage.outputTokens;

  const tokenFormatter =
    tokens >= 10_000 ? tokenCountFormatterCompact : tokenCountFormatterStandard;

  const tokenLabel = `${tokenFormatter.format(tokens)} tokens`;

  if (usage.costUsd === null) return tokenLabel;

  const costFormatter =
    usage.costUsd < 0.01 ? costFormatterFractions : costFormatterCents;

  const costLabel = costFormatter.format(usage.costUsd);

  return `${tokenLabel} · ${costLabel}`;
}
