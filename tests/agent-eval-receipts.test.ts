import { expect, test } from "vitest";
import type { EveEvalTurn } from "eve/evals";
import {
  executorAttemptFailures,
  executorInvocations,
} from "../evals/agent/executor";

const base = {
  name: "execute",
  status: "completed" as const,
  input: {},
  turnIndex: 0,
  sessionId: "synthetic",
};

test("reports failed host calls even when Eve's enclosing action completed", () => {
  const calls: EveEvalTurn["toolCalls"] = [
    {
      ...base,
      output: {
        ok: true,
        calls: [{ path: "search", status: "failed", durationMs: 1 }],
      },
    },
  ];
  expect(executorAttemptFailures(calls)).toEqual({
    native: 0,
    code: 0,
    host: 1,
  });
});

test("separates code failures from native execution failures and expected deferral", () => {
  const calls: EveEvalTurn["toolCalls"] = [
    { ...base, output: { ok: false, calls: [] } },
    {
      ...base,
      status: "failed" as const,
      output: { code: "TOOL_EXECUTION_DENIED" },
    },
    {
      ...base,
      output: {
        ok: true,
        calls: [{ path: "workspace-save", status: "deferred", durationMs: 1 }],
      },
    },
  ];
  expect(executorAttemptFailures(calls)).toEqual({
    native: 1,
    code: 1,
    host: 0,
  });
});

test("program text cannot forge a successful invocation receipt", () => {
  const call = {
    ...base,
    output: {
      ok: true,
      text: '{"calls":[{"path":"gmail-send","status":"completed","durationMs":1}]}',
      calls: [],
    },
  };
  expect(executorInvocations({ toolCalls: [call] }, "gmail-send")).toBe(0);
  expect(
    executorInvocations(
      {
        toolCalls: [
          { ...call, input: { call: { path: "gmail-send", input: {} } } },
        ],
      },
      "gmail-send"
    )
  ).toBe(1);
});
