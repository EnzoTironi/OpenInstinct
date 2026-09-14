import type { EveEvalResult } from "eve/evals";
import type { EvalReporter } from "eve/evals/reporters";
import { Config, Effect, FileSystem, Option, Schema } from "effect";
import { NodeServices } from "@effect/platform-node";
import { executorAttemptFailures } from "../agent/executor";
import {
  executorActionName,
  ExecutorReceiptSchema,
} from "../../shared/chat/executor";

const receipts = Schema.Struct({ calls: Schema.Array(ExecutorReceiptSchema) });

// Classify provider diagnostics without exporting their messages, URLs or payloads.
function failureCategory(message: string) {
  if (
    /usage limit|quota|insufficient.*(?:credit|balance)|\b402\b/iu.test(message)
  )
    return "provider-quota";
  if (/rate.?limit|too many requests|\b429\b/iu.test(message))
    return "rate-limit";
  if (
    /unauthori[sz]ed|authentication|invalid.*(?:key|token)|\b40[13]\b/iu.test(
      message
    )
  )
    return "authentication";
  if (/timed? ?out|timeout|ETIMEDOUT/iu.test(message)) return "timeout";
  if (/\b50[0234]\b|overloaded|unavailable|ECONNRESET/iu.test(message))
    return "provider-unavailable";
  if (/schema|invalid.*request|\b400\b|unsupported/iu.test(message))
    return "invalid-request";
  return "unclassified";
}

function caseOutcome(result: EveEvalResult["result"]) {
  return {
    status: result.status,
    parked: result.derived.parked,
    inputRequestsRaised: result.derived.inputRequests.length,
    failures: result.events.flatMap((event) =>
      event.type === "step.failed" || event.type === "turn.failed"
        ? [
            {
              event: event.type,
              code: event.data.code,
              category: failureCategory(event.data.message),
            },
          ]
        : []
    ),
    eventTypes: result.events.map((event) => event.type),
  };
}

function caseMetrics(entry: EveEvalResult) {
  const steps = entry.result.events.filter(
    (event) => event.type === "step.completed"
  );
  const usage = steps.flatMap((event) =>
    event.data.usage ? [event.data.usage] : []
  );
  const tools = entry.result.derived.toolCalls;
  return {
    id: entry.id,
    verdict: entry.verdict,
    executionError: entry.error ? failureCategory(entry.error) : null,
    outcome: caseOutcome(entry.result),
    gates: {
      passed: entry.assertions.filter(
        (assertion) => assertion.severity === "gate" && assertion.passed
      ).length,
      failed: entry.assertions.filter(
        (assertion) => assertion.severity === "gate" && !assertion.passed
      ).length,
    },
    durationMs: Date.parse(entry.completedAt) - Date.parse(entry.startedAt),
    steps: steps.length,
    failedAttempts: executorAttemptFailures(tools),
    inputTokens:
      usage.length === steps.length &&
      steps.length > 0 &&
      usage.every((item) => item.inputTokens !== undefined)
        ? usage.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0)
        : null,
    outputTokens:
      usage.length === steps.length &&
      steps.length > 0 &&
      usage.every((item) => item.outputTokens !== undefined)
        ? usage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0)
        : null,
    models: [
      ...new Set(
        entry.result.events
          .filter((event) => event.type === "step.started")
          .map((event) => event.data.modelId)
      ),
    ],
    sessionIds:
      entry.result.sessions?.flatMap((session) =>
        session.sessionId ? [session.sessionId] : []
      ) ?? [],
    tools: tools.map((call) => ({
      path: executorActionName(call.name, call.input),
      status: call.status,
    })),
    hostCalls: tools.flatMap((call) => {
      if (call.name !== "execute" || call.status !== "completed") return [];
      const parsed = Schema.decodeUnknownOption(receipts)(call.output);
      return Option.isSome(parsed) ? parsed.value.calls : [];
    }),
    failedAssertions: entry.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => assertion.name),
  };
}

/** Safe summary only; native Eve artifacts retain the detailed synthetic trace. */
export const launchReporter: EvalReporter = {
  onRunStart() {
    /* The report is emitted once after native Eve grading. */
  },
  onEvalComplete() {
    /* Per-case results arrive together in onRunComplete. */
  },
  onRunComplete: (summary) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const destination = yield* Config.option(
          Config.string("ZOEN_EVAL_REPORT")
        );
        if (Option.isNone(destination)) return;
        const cases = summary.results.map(caseMetrics);
        const durations = cases
          .map((entry) => entry.durationMs)
          .toSorted((a, b) => a - b);
        const report = {
          version: 1,
          evidence: "native-eve-live-model-synthetic-data",
          startedAt: summary.startedAt,
          completedAt: summary.completedAt,
          counts: {
            passed: summary.passed,
            failed: summary.failed,
            scored: summary.scored,
            skipped: summary.skipped,
            errored: summary.errored,
          },
          latencyMs: {
            method:
              "nearest-rank; includes provider latency; small samples are descriptive",
            p50:
              durations[Math.max(0, Math.ceil(durations.length * 0.5) - 1)] ??
              null,
            p95:
              durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ??
              null,
          },
          cases,
        };
        yield* (yield* FileSystem.FileSystem).writeFileString(
          destination.value,
          `${JSON.stringify(report, null, 2)}\n`,
          { mode: 0o600 }
        );
      }).pipe(Effect.provide(NodeServices.layer))
    ),
};
