import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { traceTimelineRows } from "@agent/subagents/browser-agent/lib/trace/timeline";
import {
  browserBenchmarkActivity,
  browserBenchmarkActivityDurations,
  browserBenchmarkLiveViewUrl,
} from "@evals/browser/benchmark-activity";
import type { BrowserBenchmark } from "@evals/browser/benchmark-schema";
import { browserBenchmarkEnv } from "@evals/browser/env";
import {
  type BrowserBenchmarkLiveStatus,
  updateBrowserBenchmarkLiveStatus,
} from "@evals/browser/live-status";
import {
  measureWorkerTask,
  terminalWorkerMessage,
} from "@evals/browser/worker-events";
import type { MessageStreamEvent } from "eve/client";
import type { EveEvalResult, EveEvalRunSummary } from "eve/evals";
import type { EvalReporter } from "eve/evals/reporters";
import { z } from "zod";

const tableWidths = [34, 8, 10, 12, 64] as const;

const taskNames = new Map<string, string>();

const completedTasks = new Map<
  string,
  ReturnType<typeof summarizeTaskResult>
>();

const liveActivities = new Map<string, string>();

const liveActivityDurations = new Map<string, string>();

const liveViewUrls = new Map<string, string>();

export const browserBenchmarkReporter: EvalReporter = {
  async onRunStart(evaluations) {
    taskNames.clear();
    completedTasks.clear();
    liveActivities.clear();
    liveActivityDurations.clear();
    liveViewUrls.clear();

    for (const evaluation of evaluations) {
      taskNames.set(evaluation.id, evaluation.description ?? evaluation.id);
    }

    console.log("");
    console.log(tableBorder());
    console.log(
      tableRow(["TASK", "RESULT", "TIME", "LLM COST", "TERMINAL MESSAGE"])
    );
    console.log(tableBorder());

    await updateLiveVariant((current) => ({
      ...current,
      completedAt: null,
      error: null,
      startedAt: new Date().toISOString(),
      status: "running",
      tasks: evaluations.map((evaluation) => ({
        activity: null,
        activityDurationsMs: {},
        browserLiveViewUrl: null,
        completedAt: null,
        costComplete: false,
        costUsd: null,
        durationMs: null,
        error: null,
        id: evaluation.id,
        judgeRationale: null,
        judgeScore: null,
        name: evaluation.description ?? evaluation.id,
        sessions: [],
        startedAt: null,
        status: "pending",
        success: null,
        terminalMessage: null,
        toolCalls: {},
        verdict: null,
      })),
    }));
  },
  async onEvalStart(event) {
    console.log(`START ${event.evaluation.description ?? event.evaluation.id}`);
    await updateLiveTask(event.evaluation.id, (task) => ({
      ...task,
      startedAt: event.startedAt,
      status: "running",
    }));
  },
  async onSessionStart(event) {
    console.log(
      `SESSION ${event.primary ? "root" : "worker"} ${event.sessionId} · ${event.evaluation.description ?? event.evaluation.id}`
    );
    await updateLiveTask(event.evaluation.id, (task) => ({
      ...task,
      sessions: task.sessions.some((session) => session.id === event.sessionId)
        ? task.sessions
        : [
            ...task.sessions,
            {
              id: event.sessionId,
              role: event.primary ? "root" : "worker",
              traceId: event.traceContext.traceId,
            },
          ],
    }));
  },
  async onEvalComplete(result) {
    const task = summarizeTaskResult(
      result,
      taskNames.get(result.id) ?? result.id
    );

    completedTasks.set(result.id, task);
    console.log(
      tableRow([
        task.name,
        task.success ? "SUCCESS" : "FAILURE",
        formatDuration(task.durationMs),
        formatCost(task.costUsd, task.costComplete),
        task.terminalMessage,
      ])
    );
    await updateLiveTask(result.id, (current) => ({
      ...current,
      completedAt: result.completedAt,
      costComplete: task.costComplete,
      costUsd: task.costUsd,
      durationMs: task.durationMs,
      error: task.error,
      judgeRationale: task.judgeRationale,
      judgeScore: task.judgeScore,
      status: task.success ? "passed" : failedTaskStatus(task.verdict),
      success: task.success,
      terminalMessage: task.terminalMessage,
      toolCalls: task.toolCalls,
      verdict: task.verdict,
    }));
  },
  async onRunComplete(summary) {
    console.log(tableBorder());
    const benchmark = await buildBenchmark(summary);
    const artifactPath = await writeBenchmark(benchmark);

    console.log(
      `Success ${String(benchmark.summary.passed)}/${String(benchmark.tasks.length)} | median ${formatOptionalDuration(benchmark.summary.medianDurationMs)} | p95 ${formatOptionalDuration(benchmark.summary.p95DurationMs)} | total LLM cost ${formatCost(benchmark.summary.totalCostUsd, benchmark.summary.costComplete)}`
    );
    console.log(`Benchmark saved to ${artifactPath}`);
    console.log("");
    await updateLiveVariant((current) => ({
      ...current,
      completedAt: summary.completedAt,
      status: "completed",
    }));
  },
};

function activityChangedFor(taskName: string, activity: string | null) {
  return activity !== null && liveActivities.get(taskName) !== activity;
}

function liveViewChangedFor(
  taskName: string,
  browserLiveViewUrl: string | null
) {
  return (
    browserLiveViewUrl !== null &&
    liveViewUrls.get(taskName) !== browserLiveViewUrl
  );
}

function rememberLiveActivity(
  taskName: string,
  activity: string | null,
  durationSignature: string,
  browserLiveViewUrl: string | null
) {
  if (activity !== null) liveActivities.set(taskName, activity);
  liveActivityDurations.set(taskName, durationSignature);

  if (browserLiveViewUrl !== null) {
    liveViewUrls.set(taskName, browserLiveViewUrl);
  }
}

function patchLiveTaskActivity(
  task: LiveTask,
  taskName: string,
  activity: string | null,
  activityDurationsMs: ReturnType<typeof browserBenchmarkActivityDurations>,
  browserLiveViewUrl: string | null
) {
  if (task.name !== taskName) return task;
  const updated = { ...task, activityDurationsMs };

  if (activity !== null) updated.activity = activity;

  if (browserLiveViewUrl !== null) {
    updated.browserLiveViewUrl = browserLiveViewUrl;
  }

  return updated;
}

export async function reportBrowserBenchmarkActivity(
  taskName: string,
  sessionId: string,
  events: readonly MessageStreamEvent[]
) {
  const activity = browserBenchmarkActivity(events);
  const activityDurationsMs = browserBenchmarkActivityDurations(events);
  const browserLiveViewUrl = browserBenchmarkLiveViewUrl(events);
  const durationSignature = JSON.stringify(activityDurationsMs);
  const activityChanged = activityChangedFor(taskName, activity);

  const durationsChanged =
    liveActivityDurations.get(taskName) !== durationSignature;

  const liveViewChanged = liveViewChangedFor(taskName, browserLiveViewUrl);

  await writeLiveTrace(taskName, sessionId, events);

  if (!activityChanged && !durationsChanged && !liveViewChanged) return;

  rememberLiveActivity(
    taskName,
    activity,
    durationSignature,
    browserLiveViewUrl
  );

  await updateLiveVariant((variant) => ({
    ...variant,
    tasks: variant.tasks.map((task) =>
      patchLiveTaskActivity(
        task,
        taskName,
        activity,
        activityDurationsMs,
        browserLiveViewUrl
      )
    ),
  }));
}

async function writeLiveTrace(
  taskName: string,
  sessionId: string,
  events: readonly MessageStreamEvent[]
) {
  const config = liveStatusConfig();

  if (!config || !/^[A-Za-z0-9._:-]+$/u.test(sessionId)) return;
  const traceDirectory = join(dirname(config.path), config.runId, "traces");
  const tracePath = join(traceDirectory, `${sessionId}.json`);
  const temporaryPath = `${tracePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  await mkdir(traceDirectory, { recursive: true });
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        events: events.flatMap((event) => traceTimelineRows(event)),
        sessionId,
        taskName,
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await rename(temporaryPath, tracePath);
}

function isSecondarySession(session: {
  primary: boolean;
  events: readonly unknown[];
}) {
  return !session.primary;
}

function byEventCountDesc(
  left: { events: readonly unknown[] },
  right: { events: readonly unknown[] }
) {
  return right.events.length - left.events.length;
}

function countToolCall(counts: Record<string, number>, call: { name: string }) {
  counts[call.name] = (counts[call.name] ?? 0) + 1;

  return counts;
}

function isFailedToolCall(call: { status: string }) {
  return call.status === "failed";
}

function isTaskCompletedJudge(assertion: { name: string }) {
  return assertion.name === "judge.autoevals.closedQA [task completed]";
}

function sumMessageCount(count: number, derived: { messageCount: number }) {
  return count + derived.messageCount;
}

function sumReasoningBlockCount(
  count: number,
  derived: { reasoningBlockCount: number }
) {
  return count + derived.reasoningBlockCount;
}

function fallbackTerminalMessage(result: EveEvalResult) {
  return (
    result.result.finalMessage ??
    result.error ??
    result.skipReason ??
    "No reply"
  );
}

function workerSessionFor(result: EveEvalResult) {
  return result.result.sessions
    ?.filter(isSecondarySession)
    .toSorted(byEventCountDesc)
    .at(0);
}

function derivedFacts(
  result: EveEvalResult,
  workerSession: NonNullable<ReturnType<typeof workerSessionFor>> | undefined
) {
  if (workerSession) return [workerSession.derived];

  return [result.result.derived];
}

function summarizeTaskResult(result: EveEvalResult, name: string) {
  const metrics = measureWorkerTask(
    result.result.events,
    elapsedMs(result.startedAt, result.completedAt)
  );

  const workerSession = workerSessionFor(result);
  const workerEvents = workerSession?.events;

  const terminalMessage = terminalWorkerMessage(
    fallbackTerminalMessage(result),
    workerEvents ?? result.result.events
  );

  const facts = derivedFacts(result, workerSession);
  const calls = facts.flatMap((derived) => derived.toolCalls);
  const toolCalls = calls.reduce<Record<string, number>>(countToolCall, {});
  const judge = result.assertions.find(isTaskCompletedJudge);
  const rationale = z.string().safeParse(judge?.metadata?.rationale);

  return {
    costComplete: metrics.costComplete,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    error: result.error ?? null,
    evalDurationMs: elapsedMs(result.startedAt, result.completedAt),
    failedToolCalls: calls.filter(isFailedToolCall).length,
    id: result.id,
    inputTokens: metrics.inputTokens,
    judgeRationale: rationale.success ? rationale.data : null,
    judgeScore: judge?.score ?? null,
    messageCount: facts.reduce(sumMessageCount, 0),
    modelSteps: metrics.modelSteps,
    name,
    outputTokens: metrics.outputTokens,
    reasoningBlockCount: facts.reduce(sumReasoningBlockCount, 0),
    sessionId: result.result.sessionId ?? null,
    status: result.result.status,
    success: result.verdict === "passed",
    terminalMessage,
    toolCalls,
    verdict: result.verdict,
  };
}

type SummarizedTask = ReturnType<typeof summarizeTaskResult>;

function taskFromResult(result: EveEvalResult) {
  return (
    completedTasks.get(result.id) ??
    summarizeTaskResult(result, taskNames.get(result.id) ?? result.id)
  );
}

function isSuccessfulTask(task: SummarizedTask) {
  return task.success;
}

function isFailedTask(task: SummarizedTask) {
  return !task.success;
}

function byNumberAsc(left: number, right: number) {
  return left - right;
}

function nonNullCost(task: SummarizedTask) {
  return task.costUsd === null ? [] : [task.costUsd];
}

function nonNullJudgeScore(task: SummarizedTask) {
  return task.judgeScore === null ? [] : [task.judgeScore];
}

function nonNullInputTokens(task: SummarizedTask) {
  return task.inputTokens === null ? [] : [task.inputTokens];
}

function nonNullOutputTokens(task: SummarizedTask) {
  return task.outputTokens === null ? [] : [task.outputTokens];
}

function hasRuntimeIdentity(result: EveEvalResult) {
  return result.result.runtimeIdentity !== undefined;
}

function sumFailedToolCalls(count: number, task: SummarizedTask) {
  return count + task.failedToolCalls;
}

function sumNumbers(total: number, value: number) {
  return total + value;
}

function meanOrNull(values: readonly number[]) {
  if (values.length === 0) return null;

  return values.reduce(sumNumbers, 0) / values.length;
}

function sumOrNull(values: readonly number[]) {
  if (values.length === 0) return null;

  return values.reduce(sumNumbers, 0);
}

function sumModelSteps(count: number, task: SummarizedTask) {
  return count + task.modelSteps;
}

function sumToolCallValues(taskCount: number, calls: number) {
  return taskCount + calls;
}

function totalToolCallsForTask(task: SummarizedTask) {
  return Object.values(task.toolCalls).reduce(sumToolCallValues, 0);
}

function sumTotalToolCalls(count: number, task: SummarizedTask) {
  return count + totalToolCallsForTask(task);
}

function allCostComplete(task: SummarizedTask) {
  return task.costComplete;
}

function benchmarkLabel(
  environmentLabel: string | undefined,
  gitSha: string | null,
  startedAt: string
) {
  if (environmentLabel && environmentLabel.length > 0) return environmentLabel;

  return gitSha?.slice(0, 12) ?? startedAt;
}

function successRate(passed: number, total: number) {
  if (total === 0) return 0;

  return passed / total;
}

async function resolveGitSha(summary: EveEvalRunSummary) {
  const runtimeIdentity =
    summary.results.find(hasRuntimeIdentity)?.result.runtimeIdentity;

  return runtimeIdentity?.build?.gitSha ?? (await readCurrentGitSha()) ?? null;
}

function successfulDuration(task: SummarizedTask) {
  if (!task.success) return [];

  return [task.durationMs];
}

function buildBenchmarkSummary(tasks: readonly SummarizedTask[]) {
  const successfulDurations = tasks
    .flatMap(successfulDuration)
    .toSorted(byNumberAsc);

  const measuredCosts = tasks.flatMap(nonNullCost);
  const judgeScores = tasks.flatMap(nonNullJudgeScore);
  const inputTokens = tasks.flatMap(nonNullInputTokens);
  const outputTokens = tasks.flatMap(nonNullOutputTokens);
  const passed = tasks.filter(isSuccessfulTask).length;

  return {
    costComplete: tasks.length > 0 && tasks.every(allCostComplete),
    failed: tasks.filter(isFailedTask).length,
    failedToolCalls: tasks.reduce(sumFailedToolCalls, 0),
    meanJudgeScore: meanOrNull(judgeScores),
    medianDurationMs: percentile(successfulDurations, 0.5),
    passed,
    p95DurationMs: percentile(successfulDurations, 0.95),
    successRate: successRate(passed, tasks.length),
    totalInputTokens: sumOrNull(inputTokens),
    totalModelSteps: tasks.reduce(sumModelSteps, 0),
    totalOutputTokens: sumOrNull(outputTokens),
    totalToolCalls: tasks.reduce(sumTotalToolCalls, 0),
    totalCostUsd: sumOrNull(measuredCosts),
  };
}

async function buildBenchmark(
  summary: EveEvalRunSummary
): Promise<BrowserBenchmark> {
  const tasks = summary.results.map(taskFromResult);
  const gitSha = await resolveGitSha(summary);
  const environmentLabel = browserBenchmarkEnv.BROWSER_BENCH_LABEL?.trim();

  return {
    completedAt: summary.completedAt,
    gitSha,
    label: benchmarkLabel(environmentLabel, gitSha, summary.startedAt),
    startedAt: summary.startedAt,
    summary: buildBenchmarkSummary(tasks),
    target: {
      kind: summary.target.kind,
      url: summary.target.url,
    },
    tasks,
    version: 1,
  };
}

async function readCurrentGitSha() {
  try {
    const gitDirectory = join(process.cwd(), ".git");
    const head = (await readFile(join(gitDirectory, "HEAD"), "utf8")).trim();
    const referencePrefix = "ref: ";

    if (!head.startsWith(referencePrefix)) {
      return /^[0-9a-f]{40}$/u.test(head) ? head : undefined;
    }

    const reference = head.slice(referencePrefix.length);

    if (!/^refs\/[a-zA-Z0-9._/-]+$/u.test(reference)) return undefined;
    const sha = (await readFile(join(gitDirectory, reference), "utf8")).trim();

    return /^[0-9a-f]{40}$/u.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

async function writeBenchmark(benchmark: BrowserBenchmark) {
  const explicitPath = browserBenchmarkEnv.BROWSER_BENCH_ARTIFACT_PATH?.trim();

  const directory = explicitPath
    ? dirname(explicitPath)
    : join(process.cwd(), ".eve", "browser-benchmarks");

  const safeLabel = benchmark.label.replaceAll(/[^a-zA-Z0-9._-]/gu, "-");
  const timestamp = benchmark.startedAt.replaceAll(":", "-");

  const artifactPath =
    explicitPath ?? join(directory, `${timestamp}-${safeLabel}.json`);

  const serialized = `${JSON.stringify(benchmark, null, 2)}\n`;

  await mkdir(directory, { recursive: true });
  await writeFile(artifactPath, serialized, "utf8");

  if (!explicitPath) {
    await writeFile(join(directory, "latest.json"), serialized, "utf8");
  }

  return artifactPath;
}

function percentile(sortedValues: readonly number[], percentileValue: number) {
  if (sortedValues.length === 0) return null;
  const index = Math.ceil(sortedValues.length * percentileValue) - 1;

  return sortedValues[Math.max(0, index)] ?? null;
}

function elapsedMs(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function formatDuration(milliseconds: number) {
  return milliseconds < 1_000
    ? `${String(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatOptionalDuration(milliseconds: number | null) {
  return milliseconds === null ? "—" : formatDuration(milliseconds);
}

function formatCost(costUsd: number | null, complete: boolean) {
  if (costUsd === null) return "—";

  return `${complete ? "" : "~"}$${costUsd.toFixed(6)}`;
}

function tableBorder() {
  return `+${tableWidths.map((width) => "-".repeat(width + 2)).join("+")}+`;
}

function tableRow(values: readonly string[]) {
  const cells = tableWidths.map((width, index) => {
    const value = values[index] ?? "";

    const clipped =
      value.length > width
        ? `${value.slice(0, Math.max(0, width - 1))}…`
        : value;

    return ` ${clipped.padEnd(width)} `;
  });

  return `|${cells.join("|")}|`;
}

type LiveVariant = BrowserBenchmarkLiveStatus["variants"]["baseline"];

type LiveTask = LiveVariant["tasks"][number];

async function updateLiveVariant(
  update: (variant: LiveVariant) => LiveVariant
) {
  const config = liveStatusConfig();

  if (!config) return;
  await updateBrowserBenchmarkLiveStatus(
    config.path,
    config.runId,
    (status) => ({
      ...status,
      status: status.status === "preparing" ? "running" : status.status,
      variants: {
        ...status.variants,
        [config.variant]: update(status.variants[config.variant]),
      },
    })
  );
}

async function updateLiveTask(
  id: string,
  update: (task: LiveTask) => LiveTask
) {
  await updateLiveVariant((variant) => ({
    ...variant,
    tasks: variant.tasks.map((task) => (task.id === id ? update(task) : task)),
  }));
}

function liveStatusConfig() {
  const path = browserBenchmarkEnv.BROWSER_BENCH_STATUS_PATH?.trim();
  const runId = browserBenchmarkEnv.BROWSER_BENCH_RUN_ID?.trim();
  const variant = browserBenchmarkEnv.BROWSER_BENCH_VARIANT;

  return path && runId && variant ? { path, runId, variant } : null;
}

function failedTaskStatus(
  verdict: BrowserBenchmark["tasks"][number]["verdict"]
) {
  return verdict === "skipped" || verdict === "scored" ? verdict : "failed";
}
