import { approvalMessageSchema } from "./approval-message";
import type { Session } from "eve/channels";
import { ASK_QUESTION_INPUT_SCHEMA } from "eve/tools/ask_question";
import {
  defaultMessageReducer,
  inputRequestSchema,
  type EveMessageData,
  type InputRequest,
  type MessageStreamEvent,
} from "eve/client";
import { z } from "zod";
import { quarantineCardMessage } from "../../server/operon/copy";

const emailRegisterApprovalInput = z.object({
  card: z.string().min(1),
  viewedDigest: z.string().length(64),
});

export const channelQuestionSchema = ASK_QUESTION_INPUT_SCHEMA.refine(
  (input) =>
    approvalMessageSchema.safeParse(channelQuestionText(input)).success,
  "The complete question and option labels must be non-empty, well-formed text within 16384 characters. Ask a shorter question."
);

export function renderChannelInput(request: InputRequest) {
  if (request.kind === "tool-approval") {
    const toolName = request.action.toolName;
    switch (toolName) {
      case "email-register": {
        const { card, viewedDigest } = emailRegisterApprovalInput.parse(
          request.action.input
        );
        return approvalMessageSchema.parse(
          quarantineCardMessage(card, viewedDigest)
        );
      }
      default:
        return approvalMessageSchema.parse(request.action.input.approvalMessage);
    }
  }
  return approvalMessageSchema.parse(channelQuestionText(request));
}

function channelQuestionText(
  request: Pick<InputRequest, "prompt" | "options">
) {
  return [
    request.prompt,
    ...(request.options ?? []).map(
      (option) =>
        `${option.label}${option.description ? `: ${option.description}` : ""}`
    ),
  ].join("\n\n");
}

export function pendingChannelInputs(data: EveMessageData): InputRequest[] {
  return data.messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (
        part.type !== "dynamic-tool" ||
        (part.state !== "input-available" &&
          part.state !== "approval-requested") ||
        !part.toolMetadata?.eve?.inputRequest ||
        part.toolMetadata.eve.inputResponse
      )
        return [];
      return [
        inputRequestSchema.parse({
          ...part.toolMetadata.eve.inputRequest,
          action: {
            callId: part.toolCallId,
            input: part.input,
            kind: "tool-call",
            toolName: part.toolName,
          },
        }),
      ];
    })
  );
}

export async function readChannelInputs(session: Session, signal: AbortSignal) {
  signal.throwIfAborted();
  const tail = await session.getStreamTailIndex();
  if (tail < 0) return [];
  return readChannelInputStream(
    await session.getEventStream({ startIndex: 0 }),
    tail,
    signal
  );
}

export async function readChannelInputStream(
  stream: ReadableStream<MessageStreamEvent>,
  tail: number,
  signal: AbortSignal
) {
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", cancel, { once: true });
  const reducer = defaultMessageReducer();
  let data = reducer.initial();
  try {
    for (let index = 0; index <= tail; index++) {
      signal.throwIfAborted();
      // The durable stream must be reduced in event order.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const item = await reader.read();
      if (item.done)
        throw new Error("The session stream ended before its captured tail.");
      data = reducer.reduce(data, item.value);
    }
    signal.throwIfAborted();
    return pendingChannelInputs(data);
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel();
  }
}
