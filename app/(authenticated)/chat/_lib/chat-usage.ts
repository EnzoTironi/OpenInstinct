import type { ChatUsage } from "@shared/chat/schema";
import type { MessageStreamEvent } from "eve/client";

interface StepUsageAcc {
  completedSteps: number;
  costUsd: number;
  inputTokens: number;
  measuredCosts: number;
  outputTokens: number;
}

function emptyStepUsage(): StepUsageAcc {
  return {
    completedSteps: 0,
    costUsd: 0,
    inputTokens: 0,
    measuredCosts: 0,
    outputTokens: 0,
  };
}

function accumulateStepUsage(
  acc: StepUsageAcc,
  event: MessageStreamEvent
): StepUsageAcc {
  if (event.type !== "step.completed") return acc;

  const next = {
    ...acc,
    completedSteps: acc.completedSteps + 1,
    inputTokens: acc.inputTokens + (event.data.usage?.inputTokens ?? 0),
    outputTokens: acc.outputTokens + (event.data.usage?.outputTokens ?? 0),
  };

  if (event.data.usage?.costUsd === undefined) return next;

  return {
    ...next,
    costUsd: next.costUsd + event.data.usage.costUsd,
    measuredCosts: next.measuredCosts + 1,
  };
}

function finalizeStepUsage(acc: StepUsageAcc): ChatUsage {
  const fullyMeasured =
    acc.completedSteps > 0 && acc.measuredCosts === acc.completedSteps;

  return {
    costUsd: fullyMeasured ? acc.costUsd : null,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
  };
}

export function summarizeChatUsage(
  events: readonly MessageStreamEvent[]
): ChatUsage {
  return finalizeStepUsage(events.reduce(accumulateStepUsage, emptyStepUsage()));
}

interface CombinedUsageAcc {
  costUsd: number;
  hasMeasuredCost: boolean;
  hasUnmeasuredUsage: boolean;
  inputTokens: number;
  outputTokens: number;
}

function emptyCombinedUsage(): CombinedUsageAcc {
  return {
    costUsd: 0,
    hasMeasuredCost: false,
    hasUnmeasuredUsage: false,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function accumulateCombinedUsage(
  acc: CombinedUsageAcc,
  usage: ChatUsage
): CombinedUsageAcc {
  const next = {
    ...acc,
    inputTokens: acc.inputTokens + usage.inputTokens,
    outputTokens: acc.outputTokens + usage.outputTokens,
  };

  if (usage.costUsd === null) {
    return {
      ...next,
      hasUnmeasuredUsage:
        next.hasUnmeasuredUsage || usage.inputTokens + usage.outputTokens > 0,
    };
  }

  return {
    ...next,
    costUsd: next.costUsd + usage.costUsd,
    hasMeasuredCost: true,
  };
}

export function combineChatUsage(usages: readonly ChatUsage[]): ChatUsage {
  const acc = usages.reduce(accumulateCombinedUsage, emptyCombinedUsage());

  return {
    costUsd:
      acc.hasMeasuredCost && !acc.hasUnmeasuredUsage ? acc.costUsd : null,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
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
