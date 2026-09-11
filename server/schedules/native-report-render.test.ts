import { expect, test } from "vitest";

import {
  nativeReportReceiptStatus,
  nativeReportOutputSetComplete,
  renderNativeReport,
} from "./native-report-render";

test.each([
  [[], "queued"],
  [["sent"], "delivered"],
  [["sent", "queued"], "queued"],
  [["sent", "uncertain"], "uncertain"],
  [["cancelled", "dispatching"], "queued"],
  [["cancelled", "uncertain"], "uncertain"],
  [["sent", "cancelled"], "cancelled"],
  [["sent", "failed"], "failed"],
  [["failed", "queued"], "queued"],
] as const)(
  "classifies only the complete report receipts %j as %s",
  (statuses, expected) => {
    expect(nativeReportReceiptStatus(statuses)).toBe(expected);
  }
);

test("renders stored results without agent instructions or raw artifact JSON", () => {
  expect(
    renderNativeReport({
      prompt: "Task",
      pendingInputRequests: null,
      outcome: {
        kind: "result",
        summary: "Ready",
        details: "Details",
        urgency: "normal",
        artifacts: [{ id: "artifact-id", label: "Report" }],
      },
    })
  ).toBe("Ready\n\nDetails\n\nSaved artifact: Report. Ask me to open it.");
  expect(
    renderNativeReport({
      prompt: "Task",
      pendingInputRequests: null,
      outcome: { kind: "nothing_to_report", reason: "No change" },
    })
  ).toBeNull();
});

test("renders pending questions and choices with a usable response instruction", () => {
  const text = renderNativeReport({
    prompt: "Book lunch",
    outcome: null,
    pendingInputRequests: [
      {
        requestId: "request",
        kind: "question",
        prompt: "Which day?",
        options: [{ id: "tue", label: "Tuesday", description: "Next week" }],
        action: {
          kind: "tool-call",
          callId: "call",
          toolName: "ask_question",
          input: {},
        },
      },
    ],
  });

  expect(text).toContain("Book lunch");
  expect(text).toContain("Which day?\nTuesday — Next week");
  expect(text).toContain("Reply in this conversation");
  expect(text).not.toContain("callId");
});

test("pending task summary never splits surrogate pairs", () => {
  const text = renderNativeReport({
    prompt: `${"a".repeat(499)}😀${"b".repeat(1000)}`,
    outcome: null,
    pendingInputRequests: [
      {
        requestId: "request",
        kind: "question",
        prompt: "Which day?",
        action: {
          kind: "tool-call",
          callId: "call",
          toolName: "ask_question",
          input: {},
        },
      },
    ],
  });

  expect(text?.isWellFormed()).toBe(true);
  expect(text).toContain("😀…");
});

test("oversized approval request asks for the complete waiting task instead of truncating choices", () => {
  const text = renderNativeReport({
    prompt: "Book lunch",
    outcome: null,
    pendingInputRequests: [
      {
        requestId: "request",
        kind: "tool-approval",
        prompt: "q".repeat(16_384),
        options: [
          {
            id: "deny",
            label: "Do not book",
            description: "No payment will be made",
          },
        ],
        action: {
          kind: "tool-call",
          callId: "call",
          toolName: "book",
          input: {},
        },
      },
    ],
  });

  expect(text).toContain("Ask me to review the waiting task");
  expect(text).toContain("Book lunch");
  expect(text?.length).toBeLessThanOrEqual(16_384);
  expect(text?.isWellFormed()).toBe(true);
  expect(text).not.toContain("q".repeat(20));
  expect(text).not.toContain("Do not book");
});

test("complete output seal requires exact IDs, every chunk and contiguous indices", () => {
  const prefix = "schedulereport:run:1:";

  const chunks = [
    { id: "first", key: `${prefix}0` },
    { id: "second", key: `${prefix}1` },
  ];

  const bindings = [
    { chunkIndex: 0, outboxId: "first" },
    { chunkIndex: 1, outboxId: "second" },
  ];

  expect(nativeReportOutputSetComplete(bindings, chunks, prefix)).toBe(true);
  expect(
    nativeReportOutputSetComplete(bindings.slice(0, 1), chunks, prefix)
  ).toBe(false);
  expect(nativeReportOutputSetComplete([], [], prefix)).toBe(false);
  expect(
    nativeReportOutputSetComplete(
      [
        { chunkIndex: 0, outboxId: "first" },
        { chunkIndex: 2, outboxId: "second" },
      ],
      chunks,
      prefix
    )
  ).toBe(false);
  expect(
    nativeReportOutputSetComplete(
      bindings,
      [
        { id: "first", key: `${prefix}0` },
        { id: "foreign", key: `${prefix}1` },
      ],
      prefix
    )
  ).toBe(false);
});
