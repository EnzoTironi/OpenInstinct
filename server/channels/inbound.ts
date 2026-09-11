import { DateTime, Effect, Schema } from "effect";

import { MessagePayloadSchema, type MessagePayload } from "../messaging/model";
import { ProviderInputError } from "./provider-errors";

const decodeFinite = Schema.decodeUnknownEffect(Schema.Finite);

const decodeMessagePayloadSchema =
  Schema.decodeUnknownEffect(MessagePayloadSchema);

export const ProviderReferenceSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isTrimmed()
);

export const LoginTokenSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{16,128}$/)
);

const decodeEffect_LoginTokenSchema =
  Schema.decodeUnknownEffect(LoginTokenSchema);

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
  yield* decodeFinite(nowMs).pipe(
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

const buildMessagePayloadCandidate = (
  payload: MessagePayload
): Schema.MutableJsonObject => {
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

  return candidate;
};

const isTelegramAuthPrefix = (text: string) =>
  /^\/(?:start|confirm)(?:@|\s|$)/i.test(text);

const matchTelegramAuthCommand = (text: string) =>
  /^\/(start|confirm)(?:@([A-Za-z0-9_]+))?(?:\s+(\S+))?\s*$/i.exec(text);

const commandTargetsOtherBot = (
  mentioned: string | undefined,
  botUsername: string | undefined
) =>
  Boolean(mentioned && mentioned.toLowerCase() !== botUsername?.toLowerCase());

const isBareStartGreeting = (command: RegExpExecArray) =>
  command[1]?.toLowerCase() === "start" && !command[3];

const telegramAuthAction = (command: RegExpExecArray) =>
  command[1]?.toLowerCase() === "start"
    ? ("start" as const)
    : ("confirm" as const);

const invalidTelegramCommand =
  (provider: InboundCoordinates["channel"]) => () =>
    new ProviderInputError({
      provider,
      reason: "invalid_command",
    });

const parseGroupTelegramAuthCommand = (text: string) => {
  // Auth challenges stay private-only; groups never mint login/link commands.
  if (isTelegramAuthPrefix(text)) return null;

  return { kind: "none" as const };
};

type TelegramAuthParse =
  | { readonly kind: "command"; readonly event: InboundEvent }
  | { readonly kind: "greeting" }
  | { readonly kind: "none" }
  | null;

const parsePrivateTelegramAuthCommand = Effect.fn(
  "parsePrivateTelegramAuthCommand"
)(function* (
  coordinates: InboundCoordinates,
  text: string,
  botUsername?: string
): Effect.fn.Return<TelegramAuthParse, ProviderInputError> {
  const command = matchTelegramAuthCommand(text);

  if (!command && isTelegramAuthPrefix(text))
    return yield* invalidTelegramCommand(coordinates.channel)();

  if (!command) return { kind: "none" };

  if (commandTargetsOtherBot(command[2], botUsername)) return null;

  if (isBareStartGreeting(command)) return { kind: "greeting" };

  const token = yield* decodeEffect_LoginTokenSchema(command[3]).pipe(
    Effect.mapError(invalidTelegramCommand(coordinates.channel))
  );

  return {
    kind: "command",
    event: {
      ...coordinates,
      kind: "command",
      command: telegramAuthAction(command),
      token,
    },
  };
});

const parseTelegramAuthCommand = Effect.fn("parseTelegramAuthCommand")(
  function* (
    coordinates: InboundCoordinates,
    text: string,
    botUsername?: string
  ): Effect.fn.Return<TelegramAuthParse, ProviderInputError> {
    if (coordinates.chatKind === "group")
      return parseGroupTelegramAuthCommand(text);

    if (coordinates.channel !== "telegram") return { kind: "none" };

    return yield* parsePrivateTelegramAuthCommand(
      coordinates,
      text,
      botUsername
    );
  }
);

export const normalizeInbound = Effect.fn("normalizeInbound")(function* (
  coordinates: InboundCoordinates,
  payload: MessagePayload,
  botUsername?: string
): Effect.fn.Return<InboundEvent | null, ProviderInputError> {
  const text = payload.text?.trim() ?? "";

  const auth = yield* parseTelegramAuthCommand(coordinates, text, botUsername);

  if (auth === null) return null;

  if (auth.kind === "command") return auth.event;

  if (!text && !payload.attachments?.length) return null;

  if (auth.kind === "greeting") {
    // Bare /start is not a login token command; fall through as a message when
    // there is payload content, otherwise drop.
  }

  const normalized = yield* decodeMessagePayloadSchema(
    buildMessagePayloadCandidate(payload)
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
