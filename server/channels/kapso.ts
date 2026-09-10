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
  normalizeInbound,
  ProviderReferenceSchema,
  validateEventAge,
  type InboundEvent,
} from "./inbound";
import { detectKapsoChatKind } from "./group-policy";
import {
  ProviderInputError,
  ProviderUncertain,
  requestProviderJson,
} from "./provider-errors";
import { downloadMediaBytes } from "./media/download";
import { ChannelMediaError } from "./media/policy";

const phone = Schema.String.check(Schema.isPattern(/^\+?[1-9][0-9]{5,14}$/));
const phoneId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,31}$/));
const messageId = Schema.String.check(
  Schema.isPattern(/^wamid\.[A-Za-z0-9_+/=.-]{1,240}$/)
);
export const KapsoInstallationSchema = Schema.Struct({
  phoneNumberId: phoneId,
  phoneNumber: phone,
});
export type KapsoInstallation = typeof KapsoInstallationSchema.Type;
const media = Schema.Struct({
  id: ProviderReferenceSchema,
  mime_type: Schema.optionalKey(ProviderReferenceSchema),
  filename: Schema.optionalKey(ProviderReferenceSchema),
  caption: Schema.optionalKey(Schema.String),
});
const message = Schema.Struct({
  id: messageId,
  timestamp: Schema.String.check(Schema.isPattern(/^[0-9]{1,12}$/)),
  type: Schema.String,
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.Struct({ body: Schema.String })),
  context: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: messageId }))),
  image: Schema.optionalKey(media),
  document: Schema.optionalKey(media),
  audio: Schema.optionalKey(media),
  video: Schema.optionalKey(media),
  sticker: Schema.optionalKey(media),
  kapso: Schema.Struct({
    direction: Schema.String,
    status: Schema.String,
    origin: Schema.optionalKey(Schema.String),
    media_data: Schema.optionalKey(
      Schema.Struct({
        filename: Schema.optionalKey(ProviderReferenceSchema),
        content_type: Schema.optionalKey(ProviderReferenceSchema),
      })
    ),
  }),
});
const envelope = Schema.Struct({
  phone_number_id: phoneId,
  message: Schema.optionalKey(message),
  conversation: Schema.Struct({
    phone_number_id: phoneId,
    phone_number: Schema.optionalKey(Schema.String),
    type: Schema.optionalKey(Schema.String),
    is_group: Schema.optionalKey(Schema.Boolean),
  }),
});
const batch = Schema.Struct({
  batch: Schema.Literal(true),
  type: Schema.String,
  data: Schema.Array(envelope).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100)
  ),
});
const malformed = () =>
  new ProviderInputError({ provider: "kapso", reason: "malformed" });
const digits = (value: string) => value.replace(/^\+/, "");

const normalizeEnvelope = Effect.fn("Kapso.normalizeEnvelope")(function* (
  item: typeof envelope.Type,
  installation: KapsoInstallation,
  nowMs: number
): Effect.fn.Return<InboundEvent | null, ProviderInputError> {
  if (
    item.phone_number_id !== installation.phoneNumberId ||
    item.conversation.phone_number_id !== installation.phoneNumberId
  ) {
    return yield* new ProviderInputError({
      provider: "kapso",
      reason: "wrong_installation",
    });
  }
  const incoming = item.message;
  if (
    incoming?.kapso.direction !== "inbound" ||
    (incoming.kapso.status !== "received" &&
      incoming.kapso.status !== "delivered")
  )
    return null;
  // Documented live origins; direction/status still exclude Business App sends.
  // https://docs.kapso.ai/docs/platform/webhooks/advanced#message-origin
  // History imports, missing and future origins must never become login commands.
  if (
    incoming.kapso.origin !== "cloud_api" &&
    incoming.kapso.origin !== "business_app"
  )
    return null;
  // Kapso/WA group mention signals are not yet provider-normalized (G03).
  // Detect group scope explicitly, then keep ingress closed to avoid spam.
  const chatKind = detectKapsoChatKind(item.conversation);
  if (chatKind === "group" || incoming.type === "system") return null;
  const sender = yield* Schema.decodeUnknownEffect(phone)(incoming.from).pipe(
    Effect.mapError(
      () =>
        new ProviderInputError({
          provider: "kapso",
          reason: "unsupported_identity",
        })
    )
  );
  const senderId = digits(sender);
  if (senderId === digits(installation.phoneNumber)) return null;
  if (
    (incoming.to !== undefined &&
      digits(incoming.to) !== digits(installation.phoneNumber)) ||
    (item.conversation.phone_number !== undefined &&
      digits(item.conversation.phone_number) !== senderId)
  ) {
    return yield* new ProviderInputError({
      provider: "kapso",
      reason: "wrong_installation",
    });
  }
  const occurredAt = yield* validateEventAge(
    "kapso",
    Number(incoming.timestamp),
    nowMs
  );
  let attachment: typeof media.Type | undefined;
  switch (incoming.type) {
    case "text":
      break;
    case "image":
      attachment = incoming.image;
      break;
    case "document":
      attachment = incoming.document;
      break;
    case "audio":
      attachment = incoming.audio;
      break;
    case "video":
      attachment = incoming.video;
      break;
    case "sticker":
      attachment = incoming.sticker;
      break;
    default:
      return null;
  }
  if (incoming.type !== "text" && attachment === undefined)
    return yield* malformed();
  const payload = {
    text: incoming.type === "text" ? incoming.text?.body : attachment?.caption,
    attachments: attachment
      ? [
          {
            id: attachment.id,
            mediaType:
              attachment.mime_type ??
              incoming.kapso.media_data?.content_type ??
              "application/octet-stream",
            name: attachment.filename ?? incoming.kapso.media_data?.filename,
          },
        ]
      : [],
    replyToMessageId: incoming.context?.id,
  };
  return yield* normalizeInbound(
    {
      channel: "kapso",
      installationId: installation.phoneNumberId,
      eventId: incoming.id,
      messageId: incoming.id,
      senderId,
      occurredAt,
      chatKind: "private",
      chatId: senderId,
    },
    payload
  );
});

/** Parses signed v2 body data; webhook event headers never select authority. */
export const parseKapsoWebhook = Effect.fn("parseKapsoWebhook")(function* (
  value: Schema.Json,
  configuration: KapsoInstallation,
  nowMs: number
): Effect.fn.Return<readonly InboundEvent[], ProviderInputError> {
  const installation = yield* Schema.decodeUnknownEffect(
    KapsoInstallationSchema
  )(configuration).pipe(Effect.mapError(malformed));
  const marker = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ batch: Schema.optionalKey(Schema.Boolean) })
  )(value).pipe(Effect.mapError(malformed));
  const items = marker.batch
    ? (yield* Schema.decodeUnknownEffect(batch)(value).pipe(
        Effect.mapError(malformed)
      )).data
    : [
        yield* Schema.decodeUnknownEffect(envelope)(value).pipe(
          Effect.mapError(malformed)
        ),
      ];
  const events = yield* Effect.forEach(items, (item) =>
    normalizeEnvelope(item, installation, nowMs)
  );
  return events.filter((event) => event !== null);
});

const readInstallation = Config.all({
  phoneNumberId: Config.string("KAPSO_PHONE_NUMBER_ID"),
  phoneNumber: Config.string("KAPSO_PHONE_NUMBER"),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(KapsoInstallationSchema)),
  Effect.mapError(
    () => new ProviderInputError({ provider: "kapso", reason: "configuration" })
  )
);
const sendInput = Schema.Struct({
  targetId: phone,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  reply: Schema.optional(messageId),
});
const receipt = Schema.Struct({
  messaging_product: Schema.Literal("whatsapp"),
  contacts: Schema.Array(Schema.Struct({ input: phone, wa_id: phone })).check(
    Schema.isLengthBetween(1, 1)
  ),
  messages: Schema.Array(Schema.Struct({ id: messageId })).check(
    Schema.isLengthBetween(1, 1)
  ),
});

const downloadableMedia = Schema.Struct({
  id: ProviderReferenceSchema,
  file_size: Schema.String.check(Schema.isPattern(/^[0-9]+$/u)),
  download_url: Schema.String.check(
    Schema.makeFilter((value) => {
      try {
        const url = new URL(value);
        return (
          url.origin === "https://api.kapso.ai" &&
          url.pathname === "/meta/whatsapp/media_download" &&
          !url.username &&
          !url.password &&
          !url.hash &&
          Boolean(url.searchParams.get("token"))
        );
      } catch {
        return false;
      }
    })
  ),
});

const makeKapso = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const sendText = Effect.fn("Kapso.sendText")(function* (
    targetId: string,
    text: string,
    reply?: string
  ) {
    const input = yield* Schema.decodeUnknownEffect(sendInput)({
      targetId,
      text,
      reply,
    }).pipe(
      Effect.mapError(
        () =>
          new ProviderInputError({
            provider: "kapso",
            reason: "invalid_target",
          })
      )
    );
    const installation = yield* readInstallation;
    const key = yield* Config.redacted("KAPSO_API_KEY").pipe(
      Effect.mapError(
        () =>
          new ProviderInputError({ provider: "kapso", reason: "configuration" })
      )
    );
    const body: Schema.MutableJsonObject = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: digits(input.targetId),
      type: "text",
      text: { body: input.text, preview_url: false },
    };
    if (input.reply) body.context = { message_id: input.reply };
    const result = yield* requestProviderJson(
      http,
      "kapso",
      HttpClientRequest.post(
        `https://api.kapso.ai/meta/whatsapp/v24.0/${installation.phoneNumberId}/messages`
      ).pipe(
        HttpClientRequest.setHeader("X-API-Key", Redacted.value(key)),
        HttpClientRequest.bodyJsonUnsafe(body)
      )
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(receipt)),
      Effect.catchTag(
        "SchemaError",
        () =>
          new ProviderUncertain({
            provider: "kapso",
            reason: "malformed_receipt",
          })
      )
    );
    const contact = result.contacts[0];
    const sentMessage = result.messages[0];
    if (
      !contact ||
      !sentMessage ||
      digits(contact.input) !== digits(input.targetId) ||
      digits(contact.wa_id) !== digits(input.targetId)
    ) {
      return yield* new ProviderUncertain({
        provider: "kapso",
        reason: "malformed_receipt",
      });
    }
    return { providerMessageId: sentMessage.id };
  });
  return {
    downloadMedia: Effect.fn("Kapso.downloadMedia")(function* (
      installationId: string,
      mediaId: string,
      maxBytes: number
    ) {
      const installation = yield* readInstallation;
      if (installation.phoneNumberId !== installationId)
        return yield* new ChannelMediaError({ reason: "wrong_installation" });
      const id = yield* Schema.decodeUnknownEffect(phoneId)(mediaId).pipe(
        Effect.mapError(
          () => new ChannelMediaError({ reason: "invalid_media" })
        )
      );
      const key = yield* Config.redacted("KAPSO_API_KEY").pipe(
        Effect.mapError(
          () => new ChannelMediaError({ reason: "download_failed" })
        )
      );
      const metadata = yield* requestProviderJson(
        http,
        "kapso",
        HttpClientRequest.get(
          `https://api.kapso.ai/meta/whatsapp/v24.0/${id}`
        ).pipe(
          HttpClientRequest.setUrlParam("phone_number_id", installationId),
          HttpClientRequest.setHeader("X-API-Key", Redacted.value(key))
        )
      ).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(downloadableMedia)),
        Effect.mapError(
          () => new ChannelMediaError({ reason: "download_failed" })
        )
      );
      if (metadata.id !== id)
        return yield* new ChannelMediaError({ reason: "invalid_media" });
      if (Number(metadata.file_size) > maxBytes)
        return yield* new ChannelMediaError({ reason: "too_large" });
      // The provider-issued URL embeds its authorization. Never forward the API key.
      const bytes = yield* downloadMediaBytes(
        http,
        HttpClientRequest.get(metadata.download_url),
        maxBytes
      );
      if (bytes.length !== Number(metadata.file_size))
        return yield* new ChannelMediaError({ reason: "invalid_media" });
      return bytes;
    }),
    parse: Effect.fn("Kapso.parse")(function* (value: Schema.Json) {
      return yield* parseKapsoWebhook(
        value,
        yield* readInstallation,
        yield* Clock.currentTimeMillis
      );
    }),
    sendText,
  };
});

export class Kapso extends Context.Service<
  Kapso,
  Effect.Success<typeof makeKapso>
>()("companion/server/channels/Kapso") {
  static readonly layer = Layer.effect(Kapso, makeKapso).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
}
