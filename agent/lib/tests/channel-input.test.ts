import { describe, expect, test } from "vitest";
import { ZodError } from "zod";
import { ASK_QUESTION_INPUT_SCHEMA } from "eve/tools/ask_question";
import { askQuestion } from "../../tools/ask_question";
import {
  defaultMessageReducer,
  type InputRequest,
  type MessageStreamEvent,
} from "eve/client";
import {
  channelQuestionSchema,
  pendingChannelInputs,
  readChannelInputStream,
  renderChannelInput,
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
      approvalMessage:
        "Vou convidar test@example.com para a reunião amanhã às 10h, no horário de Brasília. Posso enviar?",
      summary: "Reunião",
      start: "2026-09-09T10:00:00-03:00",
      attendees: ["test@example.com"],
    },
  },
};
describe("native input responses", () => {
  test("rejects an oversized question in the authored tool input schema", () => {
    expect(askQuestion.inputSchema).toBe(channelQuestionSchema);
    const input = { prompt: "x".repeat(16385) };
    expect(ASK_QUESTION_INPUT_SCHEMA.safeParse(input).success).toBe(true);
    expect(channelQuestionSchema.safeParse(input).success).toBe(false);
    expect(
      channelQuestionSchema.safeParse({ prompt: "x".repeat(16384) }).success
    ).toBe(true);
    expect(
      channelQuestionSchema.safeParse({
        prompt: "x".repeat(16383),
        options: [{ id: "yes", label: "Yes" }],
      }).success
    ).toBe(false);
  });
  test("delivers the model-authored proposal without inserting transport commands or tool JSON", () => {
    expect(renderChannelInput(request)).toBe(
      request.action.input.approvalMessage
    );
  });
  test("renders the exact proposal nested inside an Executor action", () => {
    expect(
      renderChannelInput({
        ...request,
        action: {
          ...request.action,
          toolName: "execute",
          input: {
            call: {
              path: request.action.toolName,
              input: request.action.input,
            },
          },
        },
      })
    ).toBe(request.action.input.approvalMessage);
    expect(() =>
      renderChannelInput({
        ...request,
        action: {
          ...request.action,
          toolName: "execute",
          input: {
            code: "return 'pretend approval';",
            approvalMessage: "unbound proposal",
          },
        },
      })
    ).toThrow(ZodError);
  });
  test.each([undefined, "", "  ", "x".repeat(16385)])(
    "refuses an absent or invalid authored proposal",
    (approvalMessage) => {
      expect(() =>
        renderChannelInput({
          ...request,
          action: {
            ...request.action,
            input: approvalMessage === undefined ? {} : { approvalMessage },
          },
        })
      ).toThrow(ZodError);
    }
  );
  test("renders a question and its choices as normal text", () => {
    expect(
      renderChannelInput({
        ...request,
        kind: "question",
        prompt: "Qual horário?",
        options: [
          { id: "morning", label: "De manhã", description: "antes do almoço" },
        ],
      })
    ).toBe("Qual horário?\n\nDe manhã: antes do almoço");
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
