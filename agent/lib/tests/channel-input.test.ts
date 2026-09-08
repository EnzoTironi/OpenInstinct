import { describe, expect, test } from "vitest";
import {
  defaultMessageReducer,
  type InputRequest,
  type MessageStreamEvent,
} from "eve/client";
import {
  channelInputCode,
  pendingChannelInputs,
  readChannelInputStream,
  renderChannelInput,
  resolveChannelInput,
} from "../channel-input";

const request: InputRequest = {
  requestId: "approval-1",
  kind: "tool-approval",
  display: "confirmation",
  prompt: "Criar este evento?",
  options: [
    { id: "approve", label: "Aprovar" },
    { id: "cancel", label: "Cancelar" },
  ],
  action: {
    kind: "tool-call",
    callId: "call-1",
    toolName: "calendar-create-event",
    input: {
      summary: "Reunião",
      start: "2026-09-09T10:00:00-03:00",
      attendees: ["test@example.com"],
    },
  },
};
const command = `/responder ${channelInputCode("session-1", request.requestId)} approve`;

describe("native input responses", () => {
  test("renders the exact action and bound commands", () => {
    const text = renderChannelInput("session-1", request);
    expect(text).toContain(command);
    expect(text).toContain(JSON.stringify(request.action.input, null, 2));
    expect(text).toContain("Criar este evento?");
  });
  test("answers exactly one pending request", () => {
    expect(
      resolveChannelInput("session-1", command, [
        request,
        { ...request, requestId: "approval-2" },
      ])
    ).toEqual({ requestId: request.requestId, optionId: "approve" });
  });
  test.each([
    "approve",
    "Aprovar",
    "1",
    "/responder bad approve",
    "/responder",
    "cancel",
  ])("does not resolve unbound text %s", (text) => {
    expect(resolveChannelInput("session-1", text, [request])).toBeNull();
  });
  test("rejects stale, other-session and ambiguous requests", () => {
    expect(resolveChannelInput("session-1", command, [])).toBeNull();
    expect(resolveChannelInput("session-2", command, [request])).toBeNull();
    expect(
      resolveChannelInput("session-1", command, [request, request])
    ).toBeNull();
  });
  test("maps freeform questions through the public Eve resolver", () => {
    const question: InputRequest = {
      ...request,
      kind: "question",
      options: [],
      allowFreeform: true,
    };
    expect(
      resolveChannelInput(
        "session-1",
        command.replace(" approve", " Amanhã às 10h"),
        [question]
      )
    ).toEqual({ requestId: request.requestId, text: "Amanhã às 10h" });
  });
  test("does not publish an approval command for truncated details", () => {
    expect(
      renderChannelInput("session-1", {
        ...request,
        action: { ...request.action, input: { body: "x".repeat(17000) } },
      })
    ).not.toContain("/responder");
  });
  test("projects a real public input event through Eve's reducer", () => {
    const reducer = defaultMessageReducer();
    const data = reducer.reduce(reducer.initial(), {
      type: "input.requested",
      meta: { at: "2026-09-08T19:00:00Z", id: "event-1" },
      data: {
        requests: [request],
        turnId: "turn-1",
        stepIndex: 0,
        sequence: 1,
      },
    });
    expect(pendingChannelInputs(data)).toEqual([request]);
    const resolved = reducer.reduce(data, {
      type: "input.resolved",
      meta: { at: "2026-09-08T19:00:01Z", id: "event-2" },
      data: {
        resolutions: [
          {
            kind: "tool-approval",
            outcome: "approved",
            requestId: request.requestId,
            response: { requestId: request.requestId, optionId: "approve" },
          },
        ],
        turnId: "turn-1",
        stepIndex: 0,
        sequence: 2,
      },
    });
    expect(pendingChannelInputs(resolved)).toEqual([]);
  });
});

test("an incomplete durable snapshot cannot resolve a pending request", async () => {
  const stream = new ReadableStream<MessageStreamEvent>({
    start(controller) {
      controller.close();
    },
  });
  await expect(
    readChannelInputStream(stream, 0, new AbortController().signal)
  ).rejects.toThrow("before its captured tail");
});
