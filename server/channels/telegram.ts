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
  detectTelegramChatKind,
  evaluateGroupMentionPolicy,
  telegramTextMentionsBot,
} from "./group-policy";
import {
  LoginTokenSchema,
  normalizeInbound,
  ProviderReferenceSchema,
  validateEventAge,
  type InboundCoordinates,
  type InboundEvent,
} from "./inbound";
import { downloadMediaBytes } from "./media/download";
import { ChannelMediaError } from "./media/policy";
import {
  boundRetryAfterSeconds,
  ProviderInputError,
  ProviderRejected,
  ProviderRetryable,
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

const decodeEffect_TelegramInstallationSchema = Schema.decodeUnknownEffect(
  TelegramInstallationSchema
);

export type TelegramInstallation = typeof TelegramInstallationSchema.Type;

const user = Schema.Struct({ id: positiveId, is_bot: Schema.Boolean });

const file = Schema.Struct({
  file_id: ProviderReferenceSchema,
  mime_type: Schema.optionalKey(ProviderReferenceSchema),
  file_name: Schema.optionalKey(ProviderReferenceSchema),
});

const messageEntity = Schema.Struct({
  type: Schema.String,
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  length: Schema.Int.check(Schema.isGreaterThan(0)),
  user: Schema.optionalKey(user),
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
  entities: Schema.optionalKey(
    Schema.Array(messageEntity).check(Schema.isMaxLength(100))
  ),
  caption_entities: Schema.optionalKey(
    Schema.Array(messageEntity).check(Schema.isMaxLength(100))
  ),
  reply_to_message: Schema.optionalKey(
    Schema.Struct({
      message_id: positiveId,
      from: Schema.optionalKey(user),
    })
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
  const installation = yield* decodeEffect_TelegramInstallationSchema(
    configuration
  ).pipe(Effect.mapError(malformed));

  const incoming = yield* decodeUpdate(value).pipe(
    Effect.mapError(malformed)
  );

  if (incoming.message && incoming.callback_query) return yield* malformed();
  const source = incoming.callback_query?.message ?? incoming.message;
  const sender = incoming.callback_query?.from ?? incoming.message?.from;

  if (!source || !sender || sender.is_bot) return [];

  if (String(sender.id) === installation.botId) return [];
  const chatKind = detectTelegramChatKind(source.chat.type);

  if (chatKind === "unsupported") return [];

  // Callbacks / login confirmations remain private-only.
  if (incoming.callback_query && chatKind !== "private") return [];

  if (chatKind === "private") {
    if (source.chat.id !== sender.id) return [];
  } else {
    const botUsername = installation.botUsername.replace(/^@/, "");
    const bodyText = source.text ?? source.caption;
    const entities = source.entities ?? source.caption_entities;

    const mentionedBot = telegramTextMentionsBot(
      bodyText,
      botUsername,
      entities,
      installation.botId
    );

    const replyFrom = source.reply_to_message?.from;

    const replyToBot = Boolean(
      replyFrom?.is_bot && String(replyFrom.id) === installation.botId
    );

    if (!evaluateGroupMentionPolicy({ mentionedBot, replyToBot })) return [];
  }

  const occurredAt = yield* validateEventAge("telegram", source.date, nowMs);

  const coordinates: InboundCoordinates = {
    channel: "telegram",
    installationId: installation.botId,
    eventId: String(incoming.update_id),
    senderId: String(sender.id),
    messageId: String(source.message_id),
    occurredAt,
    chatKind,
    chatId: String(source.chat.id),
  };

  const query = incoming.callback_query;

  if (query) {
    if (!source.from?.is_bot || String(source.from.id) !== installation.botId)
      return [];

    if (!query.data?.startsWith("confirm:")) return [];

    if (Buffer.byteLength(query.data, "utf8") > 64) return yield* malformed();

    const token = yield* decodeLoginTokenSchema(
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
  Effect.flatMap(decodeEffect_TelegramInstallationSchema),
  Effect.mapError(
    () =>
      new ProviderInputError({ provider: "telegram", reason: "configuration" })
  )
);

/** Private peers are positive; Telegram groups/supergroups use negative chat ids. */
const chatTargetId = Schema.String.check(
  Schema.isPattern(/^-?[1-9][0-9]{0,15}$/)
);

const sendInput = Schema.Struct({
  targetId: chatTargetId,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  reply: Schema.optional(stringId),
});
const decodeUpdate = Schema.decodeUnknownEffect(update);
const decodeLoginTokenSchema = Schema.decodeUnknownEffect(LoginTokenSchema);
const decodeSchema_String_check_Schema_isPattern_1_9_0_9_A_Za_ = Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^[1-9][0-9]*:[A-Za-z0-9_-]+$/)));
const decodeSendInput = Schema.decodeUnknownEffect(sendInput);
const decodeProviderReferenceSchema = Schema.decodeUnknownEffect(ProviderReferenceSchema);
const decodeSchema_Struct_ok_Schema_Literal_true_result_Schema = Schema.decodeUnknownEffect(Schema.Struct({
          ok: Schema.Literal(true),
          result: Schema.Literal(true),
        }));

const response = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    result: Schema.Struct({
      message_id: positiveId,
      chat: Schema.Struct({
        id: Schema.Int,
        type: Schema.Literals(["private", "group", "supergroup"]),
      }),
    }),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error_code: Schema.Int,
    parameters: Schema.optionalKey(
      Schema.Struct({
        retry_after: Schema.optionalKey(Schema.Number),
      })
    ),
  }),
]);

const decodeEffect_response = Schema.decodeUnknownEffect(response);

/** Maps Telegram application-level send failures after a 2xx HTTP envelope. */
export const telegramSendFailure = (failure: {
  error_code: number;
  parameters?: { retry_after?: number };
}): ProviderRetryable | ProviderRejected | ProviderUncertain => {
  if (failure.error_code === 429) {
    return new ProviderRetryable({
      provider: "telegram",
      status: 429,
      retryAfterSeconds: boundRetryAfterSeconds(
        failure.parameters?.retry_after
      ),
    });
  }

  if (
    failure.error_code >= 400 &&
    failure.error_code < 500 &&
    failure.error_code !== 408
  ) {
    return new ProviderRejected({
      provider: "telegram",
      status: failure.error_code,
    });
  }

  return new ProviderUncertain({
    provider: "telegram",
    reason: "server_error",
  });
};

const downloadableFile = Schema.Struct({
  ok: Schema.Literal(true),
  result: Schema.Struct({
    file_id: ProviderReferenceSchema,
    file_size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    file_path: Schema.String.check(
      Schema.isPattern(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u),
      Schema.makeFilter((path) =>
        path.split("/").every((part) => part !== "." && part !== "..")
      )
    ),
  }),
});

const decodeEffect_downloadableFile =
  Schema.decodeUnknownEffect(downloadableFile);

const makeTelegram = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  const request = Effect.fn("Telegram.request")(function* (
    method: "sendMessage" | "answerCallbackQuery" | "getFile",
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
    yield* decodeSchema_String_check_Schema_isPattern_1_9_0_9_A_Za_(token).pipe(
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
    const input = yield* decodeSendInput({
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
      Effect.flatMap(decodeEffect_response),
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
      return yield* telegramSendFailure(result);
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
    downloadMedia: Effect.fn("Telegram.downloadMedia")(function* (
      installationId: string,
      fileId: string,
      maxBytes: number
    ) {
      const installation = yield* readInstallation;

      if (installation.botId !== installationId)
        return yield* new ChannelMediaError({ reason: "wrong_installation" });

      const id = yield* decodeProviderReferenceSchema(
        fileId
      ).pipe(
        Effect.mapError(
          () => new ChannelMediaError({ reason: "invalid_media" })
        )
      );

      const metadata = yield* request("getFile", { file_id: id }).pipe(
        Effect.flatMap(decodeEffect_downloadableFile),
        Effect.mapError(
          () => new ChannelMediaError({ reason: "download_failed" })
        )
      );

      if (metadata.result.file_id !== id)
        return yield* new ChannelMediaError({ reason: "invalid_media" });

      if (
        metadata.result.file_size !== undefined &&
        metadata.result.file_size > maxBytes
      )
        return yield* new ChannelMediaError({ reason: "too_large" });

      const secret = yield* Config.redacted("TELEGRAM_BOT_TOKEN").pipe(
        Effect.mapError(
          () => new ChannelMediaError({ reason: "download_failed" })
        )
      );

      const bytes = yield* downloadMediaBytes(
        http,
        HttpClientRequest.get(
          `https://api.telegram.org/file/bot${Redacted.value(secret)}/${metadata.result.file_path}`
        ),
        maxBytes
      );

      if (
        metadata.result.file_size !== undefined &&
        bytes.length !== metadata.result.file_size
      )
        return yield* new ChannelMediaError({ reason: "invalid_media" });

      return bytes;
    }),
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
        const valid = yield* decodeLoginTokenSchema(
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
      const id = yield* decodeProviderReferenceSchema(
        callbackQueryId
      ).pipe(Effect.mapError(malformed));

      const body = yield* request("answerCallbackQuery", {
        callback_query_id: id,
      });

      yield* decodeSchema_Struct_ok_Schema_Literal_true_result_Schema(body).pipe(
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
