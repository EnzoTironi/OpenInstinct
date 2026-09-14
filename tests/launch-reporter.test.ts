import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EveEvalResult } from "eve/evals";
import { launchReporter } from "../evals/launch/reporter";

afterEach(() => vi.unstubAllEnvs());

test("retains failure and approval evidence without provider messages or payloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zoen-eval-receipt-"));
  const destination = join(directory, "receipt.json");
  vi.stubEnv("ZOEN_EVAL_REPORT", destination);
  const timestamp = "2026-09-14T00:00:00.000Z";
  const entry: EveEvalResult = {
    id: "launch/browser",
    verdict: "failed",
    startedAt: timestamp,
    completedAt: timestamp,
    assertions: [
      {
        name: "succeeded",
        severity: "gate",
        passed: false,
        score: 0,
        message: "private-assertion-payload",
      },
      { name: "completed call", severity: "gate", passed: true, score: 1 },
      { name: "no failures", severity: "soft", passed: true, score: 1 },
    ],
    result: {
      output: "private-model-output",
      finalMessage: "private-message",
      status: "failed",
      traceContexts: [],
      derived: {
        toolCalls: [],
        toolCallCount: 0,
        subagentCalls: [],
        subagentCallCount: 0,
        inputRequests: [],
        parked: false,
        messageCount: 0,
        reasoningBlockCount: 0,
      },
      events: [
        {
          type: "step.failed",
          meta: { at: timestamp, id: "synthetic-event" },
          data: {
            code: "MODEL_CALL_FAILED",
            message: "429 rate limit; Authorization: private-provider-key",
            details: { token: "private-diagnostic-token" },
            sequence: 0,
            stepIndex: 0,
            turnId: "synthetic-turn",
          },
        },
      ],
    },
  };
  try {
    await launchReporter.onRunComplete({
      target: {
        kind: "remote",
        url: "http://127.0.0.1",
        capabilities: { devRoutes: false },
      },
      startedAt: timestamp,
      completedAt: timestamp,
      results: [entry],
      passed: 0,
      failed: 1,
      scored: 0,
      skipped: 0,
      errored: 0,
    });
    const serialized = await readFile(destination, "utf8");
    expect(serialized).not.toContain("private-");
    const report: unknown = JSON.parse(serialized);
    expect(report).toMatchObject({
      cases: [
        {
          outcome: {
            status: "failed",
            parked: false,
            inputRequestsRaised: 0,
            eventTypes: ["step.failed"],
            failures: [
              {
                event: "step.failed",
                code: "MODEL_CALL_FAILED",
                category: "rate-limit",
              },
            ],
          },
          gates: { passed: 1, failed: 1 },
          failedAssertions: ["succeeded"],
        },
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
