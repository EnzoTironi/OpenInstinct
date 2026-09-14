import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EveEvalResult } from "eve/evals";
import { launchReporter } from "../evals/launch/reporter";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "zoen-eval-receipt-"));
  vi.stubEnv("ZOEN_EVAL_REPORT", join(directory, "receipt.json"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test.each([
  ["429 rate limit", "rate-limit"],
  ["The usage limit has been reached", "provider-quota"],
])(
  "retains %s evidence without provider messages or payloads",
  async (message, category) => {
    const destination = join(directory, "receipt.json");
    const timestamp = "2026-09-14T00:00:00.000Z";
    const entry: EveEvalResult = {
      id: "launch/browser",
      verdict: "failed",
      error: "Timeout while reading private-provider-payload",
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
              message: `${message}; Authorization: private-provider-key`,
              details: { token: "private-diagnostic-token" },
              sequence: 0,
              stepIndex: 0,
              turnId: "synthetic-turn",
            },
          },
        ],
      },
    };
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
          executionError: "timeout",
          outcome: {
            status: "failed",
            parked: false,
            inputRequestsRaised: 0,
            eventTypes: ["step.failed"],
            failures: [
              {
                event: "step.failed",
                code: "MODEL_CALL_FAILED",
                category,
              },
            ],
          },
          gates: { passed: 1, failed: 1 },
          failedAssertions: ["succeeded"],
        },
      ],
    });
  }
);
