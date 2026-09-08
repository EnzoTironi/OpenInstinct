import { createHash } from "node:crypto";
import type { Session } from "eve/channels";
import {
  defaultMessageReducer,
  inputRequestSchema,
  parseInputResponse,
  resolveTextToResponse,
  type EveMessageData,
  type InputRequest,
  type MessageStreamEvent,
} from "eve/client";

export function channelInputCode(sessionId: string, requestId: string) {
  return createHash("sha256")
    .update(JSON.stringify([sessionId, requestId]))
    .digest("hex")
    .slice(0, 16);
}

export function renderChannelInput(sessionId: string, request: InputRequest) {
  const code = channelInputCode(sessionId, request.requestId);
  const lines = [request.prompt];
  if (request.kind === "tool-approval") {
    lines.push(
      request.action.toolName,
      JSON.stringify(request.action.input, null, 2)
    );
  }
  for (const option of request.options ?? []) {
    lines.push(
      `${option.label}${option.description ? `: ${option.description}` : ""}\n/responder ${code} ${option.id}`
    );
  }
  if (request.allowFreeform || !request.options?.length) {
    lines.push(`Responda com /responder ${code} seguido da sua resposta.`);
  }
  const text = lines.join("\n\n");
  if (text.length > 16_384) {
    return "A solicitação precisa de uma confirmação, mas seus detalhes excedem o limite deste canal. Peça para cancelar e refazer a ação com menos detalhes.";
  }
  return text;
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

export function resolveChannelInput(
  sessionId: string,
  text: string,
  requests: readonly InputRequest[]
) {
  const match = /^\/responder\s+([a-f0-9]{16})\s+([\s\S]+)$/u.exec(text.trim());
  if (!match) return null;
  const matches = requests.filter(
    (request) => channelInputCode(sessionId, request.requestId) === match[1]
  );
  if (matches.length !== 1) return null;
  const [request] = matches;
  const answer = match[2];
  if (!request || !answer) return null;
  const response = resolveTextToResponse(answer, request);
  return response ? parseInputResponse(response) : null;
}
