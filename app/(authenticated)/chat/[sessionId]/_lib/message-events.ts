import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import {
  reactionTextFor,
  reactToMessageToolResultSchema,
} from "@shared/chat/reaction";
import { Result, Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import type { EveMessagePart } from "eve/react";

const decodeReactToMessageToolResultSchema = Schema.decodeUnknownResult(
  reactToMessageToolResultSchema
);

const decodeSendMessageToolResultSchema = Schema.decodeUnknownResult(
  sendMessageToolResultSchema
);

type ActionResultEvent = Extract<MessageStreamEvent, { type: "action.result" }>;

interface SentDelivery {
  id: string;
  parts: EveMessagePart[];
  timestamp: string;
}

type DeliveryOutput = NonNullable<
  ReturnType<typeof completedSendMessageOutput>
>;

type ReactionOutput = NonNullable<ReturnType<typeof completedReactionOutput>>;

export function messageTimestamps(events: readonly MessageStreamEvent[]) {
  const timestamps = new Map<string, string>();

  for (const event of events) {
    recordMessageTimestamp(timestamps, event);
  }

  return timestamps;
}

export function imessageTimestamps(events: readonly MessageStreamEvent[]) {
  const timestamps = new Map<string, string>();

  for (const event of events) {
    recordImessageTimestamp(timestamps, event);
  }

  return timestamps;
}

export function sentMessages(events: readonly MessageStreamEvent[]) {
  const delivered = new Set<string>();
  const messagesByTurn = new Map<string, SentDelivery[]>();

  for (const event of events) {
    if (event.type !== "action.result") continue;
    recordSentMessage(event, delivered, messagesByTurn);
  }

  return messagesByTurn;
}

function recordMessageTimestamp(
  timestamps: Map<string, string>,
  event: MessageStreamEvent
) {
  if (event.type === "message.received") {
    timestamps.set(`${event.data.turnId}:user`, event.meta.at);
  }

  if (
    event.type === "message.completed" &&
    event.data.finishReason !== "tool-calls"
  ) {
    timestamps.set(`${event.data.turnId}:assistant`, event.meta.at);
  }
}

function recordImessageTimestamp(
  timestamps: Map<string, string>,
  event: MessageStreamEvent
) {
  if (event.type === "message.received") {
    timestamps.set(`${event.data.turnId}:user`, event.meta.at);
  }
}

function recordSentMessage(
  event: ActionResultEvent,
  delivered: Set<string>,
  messagesByTurn: Map<string, SentDelivery[]>
) {
  const delivery = completedSendMessageOutput(event);
  const reaction = completedReactionOutput(event);
  const completed = delivery ?? reaction;

  if (!completed) return;

  if (shouldSkipDuplicateDelivery(delivered, delivery)) return;

  appendSentDelivery(
    messagesByTurn,
    event,
    deliveryIdFor(delivery, completed.callId),
    partsForSentMessage(event, delivery, reaction)
  );
}

function shouldSkipDuplicateDelivery(
  delivered: Set<string>,
  delivery: DeliveryOutput | undefined
): boolean {
  const deliveryId = delivery?.output.deliveryId;

  if (!deliveryId) return false;

  if (delivered.has(deliveryId)) return true;

  delivered.add(deliveryId);

  return false;
}

function deliveryIdFor(
  delivery: DeliveryOutput | undefined,
  fallbackCallId: string
): string {
  return delivery?.output.deliveryId ?? fallbackCallId;
}

function partsForSentMessage(
  event: ActionResultEvent,
  delivery: DeliveryOutput | undefined,
  reaction: ReactionOutput | undefined
): EveMessagePart[] {
  if (reaction) return reactionParts(event, reaction);

  if (delivery) return deliveryParts(event, delivery);

  return [];
}

function reactionParts(
  event: ActionResultEvent,
  reaction: ReactionOutput
): EveMessagePart[] {
  return [
    {
      state: "done",
      stepIndex: event.data.stepIndex,
      text: reactionTextFor(reaction.output.type),
      type: "text",
    },
  ];
}

function deliveryParts(
  event: ActionResultEvent,
  delivery: DeliveryOutput
): EveMessagePart[] {
  const parts: EveMessagePart[] = [];
  const text = deliveryText(delivery.output);

  if (text) {
    parts.push({
      state: "done",
      stepIndex: event.data.stepIndex,
      text,
      type: "text",
    });
  }

  appendAttachmentParts(parts, event, delivery.output);

  return parts;
}

function deliveryText(output: DeliveryOutput["output"]): string | undefined {
  if (output.kind === "link") return output.url;

  return output.text?.replaceAll("\n", "  \n");
}

function appendAttachmentParts(
  parts: EveMessagePart[],
  event: ActionResultEvent,
  output: DeliveryOutput["output"]
) {
  const attachments = output.kind === "message" ? output.attachments : [];

  for (const attachment of attachments ?? []) {
    parts.push({
      filename: attachment.name,
      mediaType: attachment.mimeType ?? defaultMediaType[attachment.kind],
      stepIndex: event.data.stepIndex,
      type: "file",
      url: attachment.url,
    });
  }
}

function appendSentDelivery(
  messagesByTurn: Map<string, SentDelivery[]>,
  event: ActionResultEvent,
  deliveryId: string,
  parts: EveMessagePart[]
) {
  const turnMessageId = `${event.data.turnId}:assistant`;
  const messages = messagesByTurn.get(turnMessageId) ?? [];
  messages.push({
    id: `${turnMessageId}:${deliveryId}`,
    parts,
    timestamp: event.meta.at,
  });
  messagesByTurn.set(turnMessageId, messages);
}

function completedReactionOutput(event: MessageStreamEvent) {
  if (event.type !== "action.result" || event.data.status !== "completed") {
    return undefined;
  }

  const result = decodeReactToMessageToolResultSchema(event.data.result);

  if (!Result.isSuccess(result)) return undefined;

  if (result.success.output.operation !== "add") return undefined;

  return { callId: event.data.result.callId, output: result.success.output };
}

function completedSendMessageOutput(event: MessageStreamEvent) {
  if (event.type !== "action.result" || event.data.status !== "completed") {
    return undefined;
  }

  const result = decodeSendMessageToolResultSchema(event.data.result);

  if (!Result.isSuccess(result)) return undefined;

  return { callId: event.data.result.callId, output: result.success.output };
}

const defaultMediaType = {
  audio: "audio/*",
  file: "application/octet-stream",
  image: "image/*",
  video: "video/*",
} as const;
