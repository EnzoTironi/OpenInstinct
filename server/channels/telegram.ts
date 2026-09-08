import {
  Clock,
  Config,
  Context,
  Effect,
  Layer,
  Redacted,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import {
  LoginTokenSchema,
  normalizeInbound,
  ProviderReferenceSchema,
  validateEventAge,
  type InboundCoordinates,
  type InboundEvent,
} from "./inbound";
import {
  ProviderInputError,
  ProviderRejected,
  ProviderUncertain,
  requestProviderJson,
} from "./provider-errors";

const positiveId = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
);
const stringId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,15}$/));
const username = Schema.String.check(
  Schema.isPattern(/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/)
);
export const TelegramInstallationSchema = Schema.Struct({
  botId: stringId,
  botUsername: username,
});
export type TelegramInstallation = typeof TelegramInstallationSchema.Type;
const user = Schema.Struct({ id: positiveId, is_bot: Schema.Boolean });
const file = Schema.Struct({
  file_id: ProviderReferenceSchema,
  mime_type: Schema.optionalKey(ProviderReferenceSchema),
  file_name: Schema.optionalKey(ProviderReferenceSchema),
});
const message = Schema.Struct({
  message_id: positiveId,
  date: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  from: Schema.optionalKey(user),
  chat: Schema.Struct({ id: Schema.Int, type: Schema.String }),
  text: Schema.optionalKey(Schema.String),
  caption: Schema.optionalKey(Schema.String),
  photo: Schema.optionalKey(Schema.Array(file).check(Schema.isMaxLength(20))),
  document: Schema.optionalKey(file),
  audio: Schema.optionalKey(file),
  voice: Schema.optionalKey(file),
  video: Schema.optionalKey(file),
  sticker: Schema.optionalKey(file),
  reply_to_message: Schema.optionalKey(
    Schema.Struct({ message_id: positiveId })
  ),
});
const callback = Schema.Struct({
  id: ProviderReferenceSchema,
  from: user,
  message: Schema.optionalKey(message),
  data: Schema.optionalKey(Schema.String),
});
const update = Schema.Struct({
  update_id: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  ),
  message: Schema.optionalKey(message),
  callback_query: Schema.optionalKey(callback),
});
const malformed = () =>
  new ProviderInputError({ provider: "telegram", reason: "malformed" });

/** Expects verified JSON. Pure normalization; no credentials or network access. */
export const parseTelegramUpdate = Effect.fn("parseTelegramUpdate")(function* (
  value: Schema.Json,
  configuration: TelegramInstallation,
  nowMs: number
): Effect.fn.Return<readonly InboundEvent[], ProviderInputError> {
  const installation = yield* Schema.decodeUnknownEffect(
    TelegramInstallationSchema
  )(configuration).pipe(Effect.mapError(malformed));
  const incoming = yield* Schema.decodeUnknownEffect(update)(value).pipe(
    Effect.mapError(malformed)
  );
  if (incoming.message && incoming.callback_query) return yield* malformed();
  const source = incoming.callback_query?.message ?? incoming.message;
  const sender = incoming.callback_query?.from ?? incoming.message?.from;
  if (!source || !sender || sender.is_bot || source.chat.type !== "private")
    return [];
  if (source.chat.id !== sender.id || String(sender.id) === installation.botId)
    return [];
  const occurredAt = yield* validateEventAge("telegram", source.date, nowMs);
  const coordinates: InboundCoordinates = {
    channel: "telegram",
    installationId: installation.botId,
    eventId: String(incoming.update_id),
    senderId: String(sender.id),
    messageId: String(source.message_id),
    occurredAt,
  };
  const query = incoming.callback_query;
  if (query) {
    if (!source.from?.is_bot || String(source.from.id) !== installation.botId)
      return [];
    if (!query.data?.startsWith("confirm:")) return [];
    if (Buffer.byteLength(query.data, "utf8") > 64) return yield* malformed();
    const token = yield* Schema.decodeUnknownEffect(LoginTokenSchema)(
      query.data.slice(8)
    ).pipe(
      Effect.mapError(
        () =>
          new ProviderInputError({
            provider: "telegram",
            reason: "invalid_command",
          })
      )
    );
    return [
      {
        ...coordinates,
        kind: "command",
        command: "confirm",
        token,
        callbackQueryId: query.id,
      },
    ];
  }
  const media =
    source.document ??
    source.audio ??
    source.voice ??
    source.video ??
    source.sticker ??
    source.photo?.at(-1);
  const payload = {
    text: source.text ?? source.caption,
    attachments: media
      ? [
          {
            id: media.file_id,
            mediaType: media.mime_type ?? "application/octet-stream",
            name: media.file_name,
          },
        ]
      : [],
    replyToMessageId: source.reply_to_message
      ? String(source.reply_to_message.message_id)
      : undefined,
  };
  const event = yield* normalizeInbound(
    coordinates,
    payload,
    installation.botUsername.replace(/^@/, "")
  );
  return event ? [event] : [];
});

const readInstallation = Config.all({
  botId: Config.string("TELEGRAM_BOT_ID"),
  botUsername: Config.string("TELEGRAM_BOT_USERNAME"),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(TelegramInstallationSchema)),
  Effect.mapError(
    () =>
      new ProviderInputError({ provider: "telegram", reason: "configuration" })
  )
);
const sendInput = Schema.Struct({
  targetId: stringId,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  reply: Schema.optional(stringId),
});
const response = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    result: Schema.Struct({
      message_id: positiveId,
      chat: Schema.Struct({ id: positiveId, type: Schema.Literal("private") }),
    }),
  }),
  Schema.Struct({ ok: Schema.Literal(false), error_code: Schema.Int }),
]);

const makeTelegram = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const request = Effect.fn("Telegram.request")(function* (
    method: "sendMessage" | "answerCallbackQuery",
    body: Schema.Json
  ) {
    const installation = yield* readInstallation;
    const secret = yield* Config.redacted("TELEGRAM_BOT_TOKEN").pipe(
      Effect.mapError(
        () =>
          new ProviderInputError({
            provider: "telegram",
            reason: "configuration",
          })
      )
    );
    const token = Redacted.value(secret);
    yield* Schema.decodeUnknownEffect(
      Schema.String.check(Schema.isPattern(/^[1-9][0-9]*:[A-Za-z0-9_-]+$/))
    )(token).pipe(
      Effect.mapError(
        () =>
          new ProviderInputError({
            provider: "telegram",
            reason: "configuration",
          })
      )
    );
    if (token.split(":")[0] !== installation.botId) {
      return yield* new ProviderInputError({
        provider: "telegram",
        reason: "configuration",
      });
    }
    return yield* requestProviderJson(
      http,
      "telegram",
      HttpClientRequest.post(
        `https://api.telegram.org/bot${token}/${method}`
      ).pipe(HttpClientRequest.bodyJsonUnsafe(body))
    );
  });
  const send = Effect.fn("Telegram.send")(function* (
    targetId: string,
    text: string,
    reply?: string,
    confirmation?: string
  ) {
    const input = yield* Schema.decodeUnknownEffect(sendInput)({
      targetId,
      text,
      reply,
    }).pipe(
      Effect.mapError(
        () =>
          new ProviderInputError({
            provider: "telegram",
            reason: "invalid_target",
          })
      )
    );
    const body: Schema.MutableJsonObject = {
      chat_id: input.targetId,
      text: input.text,
      link_preview_options: { is_disabled: true },
    };
    if (input.reply)
      body.reply_parameters = {
        message_id: Number(input.reply),
        allow_sending_without_reply: false,
      };
    if (confirmation)
      body.reply_markup = {
        inline_keyboard: [
          [{ text: "Confirm sign-in", callback_data: confirmation }],
        ],
      };
    const result = yield* request("sendMessage", body).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(response)),
      Effect.catchTag(
        "SchemaError",
        () =>
          new ProviderUncertain({
            provider: "telegram",
            reason: "malformed_receipt",
          })
      )
    );
    if (!result.ok) {
      if (
        result.error_code >= 400 &&
        result.error_code < 500 &&
        result.error_code !== 408
      ) {
        return yield* new ProviderRejected({
          provider: "telegram",
          status: result.error_code,
        });
      }
      return yield* new ProviderUncertain({
        provider: "telegram",
        reason: "server_error",
      });
    }
    if (String(result.result.chat.id) !== input.targetId) {
      return yield* new ProviderUncertain({
        provider: "telegram",
        reason: "malformed_receipt",
      });
    }
    return { providerMessageId: String(result.result.message_id) };
  });
  return {
    parse: Effect.fn("Telegram.parse")(function* (value: Schema.Json) {
      return yield* parseTelegramUpdate(
        value,
        yield* readInstallation,
        yield* Clock.currentTimeMillis
      );
    }),
    sendText: Effect.fn("Telegram.sendText")(function* (
      targetId: string,
      text: string,
      reply?: string
    ) {
      return yield* send(targetId, text, reply);
    }),
    sendLoginConfirmation: Effect.fn("Telegram.sendLoginConfirmation")(
      function* (targetId: string, token: string) {
        const valid = yield* Schema.decodeUnknownEffect(LoginTokenSchema)(
          token
        ).pipe(Effect.mapError(malformed));
        const data = `confirm:${valid}`;
        if (Buffer.byteLength(data, "utf8") > 64) return yield* malformed();
        return yield* send(
          targetId,
          "Confirm this sign-in only if you requested it in your browser.",
          undefined,
          data
        );
      }
    ),
    answerCallbackQuery: Effect.fn("Telegram.answerCallbackQuery")(function* (
      callbackQueryId: string
    ) {
      const id = yield* Schema.decodeUnknownEffect(ProviderReferenceSchema)(
        callbackQueryId
      ).pipe(Effect.mapError(malformed));
      const body = yield* request("answerCallbackQuery", {
        callback_query_id: id,
      });
      yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          ok: Schema.Literal(true),
          result: Schema.Literal(true),
        })
      )(body).pipe(
        Effect.mapError(
          () =>
            new ProviderUncertain({
              provider: "telegram",
              reason: "malformed_receipt",
            })
        )
      );
    }),
  };
});

export class Telegram extends Context.Service<
  Telegram,
  Effect.Success<typeof makeTelegram>
>()("companion/server/channels/Telegram") {
  static readonly layer = Layer.effect(Telegram, makeTelegram).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
}
