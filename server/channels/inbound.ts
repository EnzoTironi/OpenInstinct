import { DateTime, Effect, Schema } from "effect";

import { MessagePayloadSchema, type MessagePayload } from "../messaging/model";
import { ProviderInputError } from "./provider-errors";

export const ProviderReferenceSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isTrimmed()
);

export const LoginTokenSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{16,128}$/)
);

const base = {
  channel: Schema.Literals(["telegram", "kapso"]),
  installationId: ProviderReferenceSchema,
  eventId: ProviderReferenceSchema,
  senderId: ProviderReferenceSchema,
  messageId: ProviderReferenceSchema,
  occurredAt: Schema.String,
  chatKind: Schema.Literals(["private", "group"]),
  chatId: ProviderReferenceSchema,
};

const InboundEventSchema = Schema.Union([
  Schema.Struct({
    ...base,
    kind: Schema.Literal("message"),
    payload: MessagePayloadSchema,
  }),
  Schema.Struct({
    ...base,
    kind: Schema.Literal("command"),
    command: Schema.Literals(["start", "confirm"]),
    token: LoginTokenSchema,
    callbackQueryId: Schema.optionalKey(ProviderReferenceSchema),
  }),
]);

export type InboundEvent = typeof InboundEventSchema.Type;

export type InboundCoordinates = Omit<
  Extract<InboundEvent, { kind: "message" }>,
  "kind" | "payload"
>;

export const validateEventAge = Effect.fn("validateEventAge")(function* (
  channel: "telegram" | "kapso",
  timestampSeconds: number,
  nowMs: number
) {
  yield* Schema.decodeUnknownEffect(Schema.Finite)(nowMs).pipe(
    Effect.mapError(
      () => new ProviderInputError({ provider: channel, reason: "malformed" })
    )
  );
  const milliseconds = timestampSeconds * 1000;

  if (milliseconds > nowMs + 60_000) {
    return yield* new ProviderInputError({
      provider: channel,
      reason: "future_event",
    });
  }

  if (milliseconds < nowMs - 86_400_000) {
    return yield* new ProviderInputError({
      provider: channel,
      reason: "stale_event",
    });
  }

  return DateTime.formatIso(DateTime.makeUnsafe(milliseconds));
});

export const normalizeInbound = Effect.fn("normalizeInbound")(function* (
  coordinates: InboundCoordinates,
  payload: MessagePayload,
  botUsername?: string
): Effect.fn.Return<InboundEvent | null, ProviderInputError> {
  const text = payload.text?.trim() ?? "";

  if (coordinates.chatKind === "group") {
    // Auth challenges stay private-only; groups never mint login/link commands.
    if (/^\/(?:start|confirm)(?:@|\s|$)/i.test(text)) return null;
  }

  const command =
    coordinates.channel === "telegram" && coordinates.chatKind !== "group"
      ? /^\/(start|confirm)(?:@([A-Za-z0-9_]+))?(?:\s+(\S+))?\s*$/i.exec(text)
      : null;

  if (command?.[2] && command[2].toLowerCase() !== botUsername?.toLowerCase())
    return null;
  const greeting = command?.[1]?.toLowerCase() === "start" && !command[3];

  if (command && !greeting) {
    const token = yield* Schema.decodeUnknownEffect(LoginTokenSchema)(
      command[3]
    ).pipe(
      Effect.mapError(
        () =>
          new ProviderInputError({
            provider: coordinates.channel,
            reason: "invalid_command",
          })
      )
    );

    const action = command[1]?.toLowerCase() === "start" ? "start" : "confirm";

    return { ...coordinates, kind: "command", command: action, token };
  }

  if (
    coordinates.channel === "telegram" &&
    !greeting &&
    /^\/(?:start|confirm)(?:@|\s|$)/i.test(text)
  ) {
    return yield* new ProviderInputError({
      provider: coordinates.channel,
      reason: "invalid_command",
    });
  }

  if (!text && !payload.attachments?.length) return null;
  const candidate: Schema.MutableJsonObject = {};

  if (payload.text !== undefined) candidate.text = payload.text;

  if (payload.replyToMessageId !== undefined)
    candidate.replyToMessageId = payload.replyToMessageId;

  if (payload.attachments !== undefined)
    candidate.attachments = payload.attachments.map((attachment) => {
      const reference: Schema.MutableJsonObject = {
        id: attachment.id,
        mediaType: attachment.mediaType,
      };

      if (attachment.name !== undefined) reference.name = attachment.name;

      return reference;
    });

  const normalized = yield* Schema.decodeUnknownEffect(MessagePayloadSchema)(
    candidate
  ).pipe(
    Effect.mapError(
      () =>
        new ProviderInputError({
          provider: coordinates.channel,
          reason: "malformed",
        })
    )
  );

  return { ...coordinates, kind: "message", payload: normalized };
});
