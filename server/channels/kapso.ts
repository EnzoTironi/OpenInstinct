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
  detectKapsoChatKind,
  evaluateGroupMentionPolicy,
  extractKapsoGroupMentionSignals,
} from "./group-policy";
import {
  normalizeInbound,
  ProviderReferenceSchema,
  validateEventAge,
  type InboundEvent,
} from "./inbound";
import { downloadMediaBytes } from "./media/download";
import { ChannelMediaError } from "./media/policy";
import {
  ProviderInputError,
  ProviderUncertain,
  requestProviderJson,
} from "./provider-errors";

const phone = Schema.String.check(Schema.isPattern(/^\+?[1-9][0-9]{5,14}$/));

const decodeEffect_phone = Schema.decodeUnknownEffect(phone);

const phoneId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,31}$/));

const decodeEffect_phoneId = Schema.decodeUnknownEffect(phoneId);

const messageId = Schema.String.check(
  Schema.isPattern(/^wamid\.[A-Za-z0-9_+/=.-]{1,240}$/)
);

export const KapsoInstallationSchema = Schema.Struct({
  phoneNumberId: phoneId,
  phoneNumber: phone,
});

const decodeEffect_KapsoInstallationSchema = Schema.decodeUnknownEffect(
  KapsoInstallationSchema
);

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
  context: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        id: messageId,
        from_me: Schema.optionalKey(Schema.Boolean),
      })
    )
  ),
  group_id: Schema.optionalKey(ProviderReferenceSchema),
  mentions: Schema.optionalKey(
    Schema.Array(Schema.String).check(Schema.isMaxLength(32))
  ),
  mentioned_ids: Schema.optionalKey(
    Schema.Array(Schema.String).check(Schema.isMaxLength(32))
  ),
  image: Schema.optionalKey(media),
  document: Schema.optionalKey(media),
  audio: Schema.optionalKey(media),
  video: Schema.optionalKey(media),
  sticker: Schema.optionalKey(media),
  kapso: Schema.Struct({
    direction: Schema.String,
    status: Schema.String,
    origin: Schema.optionalKey(Schema.String),
    mentioned: Schema.optionalKey(Schema.Boolean),
    mentioned_business: Schema.optionalKey(Schema.Boolean),
    reply_to_business: Schema.optionalKey(Schema.Boolean),
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
    id: Schema.optionalKey(ProviderReferenceSchema),
    phone_number_id: phoneId,
    phone_number: Schema.optionalKey(Schema.String),
    type: Schema.optionalKey(Schema.String),
    is_group: Schema.optionalKey(Schema.Boolean),
  }),
});

const decodeEffect_envelope = Schema.decodeUnknownEffect(envelope);

const batch = Schema.Struct({
  batch: Schema.Literal(true),
  type: Schema.String,
  data: Schema.Array(envelope).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100)
  ),
});

const decodeEffect_batch = Schema.decodeUnknownEffect(batch);

const malformed = () =>
  new ProviderInputError({ provider: "kapso", reason: "malformed" });

const digits = (value: string) => value.replace(/^\+/, "");

const assertKapsoEnvelopeInstallation = Effect.fn(
  "Kapso.assertEnvelopeInstallation"
)(function* (
  item: typeof envelope.Type,
  installation: KapsoInstallation
): Effect.fn.Return<void, ProviderInputError> {
  if (
    item.phone_number_id !== installation.phoneNumberId ||
    item.conversation.phone_number_id !== installation.phoneNumberId
  ) {
    return yield* new ProviderInputError({
      provider: "kapso",
      reason: "wrong_installation",
    });
  }

  return yield* Effect.void;
});

const kapsoInboundAttachment = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>
): typeof media.Type | undefined | null => {
  switch (incoming.type) {
    case "text":
      return undefined;
    case "image":
      return incoming.image;
    case "document":
      return incoming.document;
    case "audio":
      return incoming.audio;
    case "video":
      return incoming.video;
    case "sticker":
      return incoming.sticker;
    default:
      return null;
  }
};

const isSelfKapsoSender = (senderId: string, installation: KapsoInstallation) =>
  senderId === digits(installation.phoneNumber);

const kapsoDestinationMismatch = (
  to: string | undefined,
  installation: KapsoInstallation
) => to !== undefined && digits(to) !== digits(installation.phoneNumber);

const kapsoPrivateConversationMismatch = (
  phoneNumber: string | undefined,
  senderId: string
) => phoneNumber !== undefined && digits(phoneNumber) !== senderId;

const kapsoIsInboundLiveMessage = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>
) => {
  if (incoming.kapso.direction !== "inbound") return false;

  if (incoming.kapso.status === "received") return true;

  return incoming.kapso.status === "delivered";
};

const kapsoIsAllowedOrigin = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>
) => {
  // Documented live origins; direction/status still exclude Business App sends.
  // https://docs.kapso.ai/docs/platform/webhooks/advanced#message-origin
  // History imports, missing and future origins must never become login commands.
  if (incoming.kapso.origin === "cloud_api") return true;

  return incoming.kapso.origin === "business_app";
};

const kapsoAttachmentMediaType = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>,
  attachment: NonNullable<ReturnType<typeof kapsoInboundAttachment>>
) =>
  attachment.mime_type ??
  incoming.kapso.media_data?.content_type ??
  "application/octet-stream";

const kapsoAttachmentName = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>,
  attachment: NonNullable<ReturnType<typeof kapsoInboundAttachment>>
) => attachment.filename ?? incoming.kapso.media_data?.filename;

const kapsoMessagePayload = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>,
  attachment: ReturnType<typeof kapsoInboundAttachment>
) => {
  const text =
    incoming.type === "text" ? incoming.text?.body : attachment?.caption;

  if (!attachment) {
    return {
      text,
      attachments: [] as const,
      replyToMessageId: incoming.context?.id,
    };
  }

  return {
    text,
    attachments: [
      {
        id: attachment.id,
        mediaType: kapsoAttachmentMediaType(incoming, attachment),
        name: kapsoAttachmentName(incoming, attachment),
      },
    ],
    replyToMessageId: incoming.context?.id,
  };
};

const kapsoChatId = (
  chatKind: ReturnType<typeof detectKapsoChatKind>,
  incoming: NonNullable<(typeof envelope.Type)["message"]>,
  item: typeof envelope.Type,
  senderId: string
) => {
  if (chatKind !== "group") return senderId;

  return (
    incoming.group_id ??
    item.conversation.id ??
    item.conversation.phone_number ??
    senderId
  );
};

const kapsoUnsupportedIdentity = () =>
  new ProviderInputError({
    provider: "kapso",
    reason: "unsupported_identity",
  });

const kapsoWrongInstallation = () =>
  new ProviderInputError({
    provider: "kapso",
    reason: "wrong_installation",
  });

const authorizeKapsoGroupSender = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>,
  installation: KapsoInstallation,
  senderId: string
) => {
  const mentionSignals = extractKapsoGroupMentionSignals({
    installationPhoneDigits: digits(installation.phoneNumber),
    mentions: incoming.mentions,
    mentionedIds: incoming.mentioned_ids,
    kapso: incoming.kapso,
    contextFromMe: incoming.context?.from_me === true,
  });

  if (!evaluateGroupMentionPolicy(mentionSignals)) return null;

  return senderId;
};

const authorizeKapsoPrivateSender = (
  item: typeof envelope.Type,
  senderId: string
) => {
  if (
    kapsoPrivateConversationMismatch(item.conversation.phone_number, senderId)
  ) {
    return Effect.fail(kapsoWrongInstallation());
  }

  return Effect.succeed(senderId);
};

const authorizeKapsoSender = Effect.fn("Kapso.authorizeSender")(function* (
  item: typeof envelope.Type,
  incoming: NonNullable<(typeof envelope.Type)["message"]>,
  installation: KapsoInstallation,
  chatKind: ReturnType<typeof detectKapsoChatKind>
): Effect.fn.Return<string | null, ProviderInputError> {
  const sender = yield* decodeEffect_phone(incoming.from).pipe(
    Effect.mapError(kapsoUnsupportedIdentity)
  );

  const senderId = digits(sender);

  if (isSelfKapsoSender(senderId, installation)) return null;

  if (kapsoDestinationMismatch(incoming.to, installation)) {
    return yield* kapsoWrongInstallation();
  }

  if (chatKind === "group") {
    return authorizeKapsoGroupSender(incoming, installation, senderId);
  }

  return yield* authorizeKapsoPrivateSender(item, senderId);
});

const kapsoShouldSkipIncoming = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>
) => {
  if (!kapsoIsInboundLiveMessage(incoming)) return true;

  if (!kapsoIsAllowedOrigin(incoming)) return true;

  return incoming.type === "system";
};

const kapsoRequireAttachment = (
  incoming: NonNullable<(typeof envelope.Type)["message"]>,
  attachment: ReturnType<typeof kapsoInboundAttachment>
) => {
  if (attachment === null) return Effect.succeed(null);

  if (incoming.type !== "text" && attachment === undefined) {
    return malformed();
  }

  return Effect.succeed(attachment);
};

const normalizeEnvelope = Effect.fn("Kapso.normalizeEnvelope")(function* (
  item: typeof envelope.Type,
  installation: KapsoInstallation,
  nowMs: number
): Effect.fn.Return<InboundEvent | null, ProviderInputError> {
  yield* assertKapsoEnvelopeInstallation(item, installation);

  const incoming = item.message;

  if (!incoming || kapsoShouldSkipIncoming(incoming)) return null;
  // Groups stay closed unless provider mention / reply-to-business signals exist.
  const chatKind = detectKapsoChatKind(item.conversation);

  const senderId = yield* authorizeKapsoSender(
    item,
    incoming,
    installation,
    chatKind
  );

  if (senderId === null) return null;

  const occurredAt = yield* validateEventAge(
    "kapso",
    Number(incoming.timestamp),
    nowMs
  );

  const attachment = yield* kapsoRequireAttachment(
    incoming,
    kapsoInboundAttachment(incoming)
  );

  if (attachment === null) return null;

  return yield* normalizeInbound(
    {
      channel: "kapso",
      installationId: installation.phoneNumberId,
      eventId: incoming.id,
      messageId: incoming.id,
      senderId,
      occurredAt,
      chatKind,
      chatId: kapsoChatId(chatKind, incoming, item, senderId),
    },
    kapsoMessagePayload(incoming, attachment)
  );
});

/** Parses signed v2 body data; webhook event headers never select authority. */
export const parseKapsoWebhook = Effect.fn("parseKapsoWebhook")(function* (
  value: Schema.Json,
  configuration: KapsoInstallation,
  nowMs: number
): Effect.fn.Return<readonly InboundEvent[], ProviderInputError> {
  const installation = yield* decodeEffect_KapsoInstallationSchema(
    configuration
  ).pipe(Effect.mapError(malformed));

  const marker =
    yield* decodeSchema_Struct_batch_Schema_optionalKey_Schema_Bool(value).pipe(
      Effect.mapError(malformed)
    );

  const items = marker.batch
    ? (yield* decodeEffect_batch(value).pipe(Effect.mapError(malformed))).data
    : [yield* decodeEffect_envelope(value).pipe(Effect.mapError(malformed))];

  const events = yield* Effect.forEach(
    items,
    (item) => normalizeEnvelope(item, installation, nowMs),
    { concurrency: 1 }
  );

  return events.filter((event) => event !== null);
});

const readInstallation = Config.all({
  phoneNumberId: Config.string("KAPSO_PHONE_NUMBER_ID"),
  phoneNumber: Config.string("KAPSO_PHONE_NUMBER"),
}).pipe(
  Effect.flatMap(decodeEffect_KapsoInstallationSchema),
  Effect.mapError(
    () => new ProviderInputError({ provider: "kapso", reason: "configuration" })
  )
);

const sendInput = Schema.Struct({
  targetId: phone,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  reply: Schema.optional(messageId),
});

const decodeSchema_Struct_batch_Schema_optionalKey_Schema_Bool =
  Schema.decodeUnknownEffect(
    Schema.Struct({ batch: Schema.optionalKey(Schema.Boolean) })
  );

const decodeSendInput = Schema.decodeUnknownEffect(sendInput);

const receipt = Schema.Struct({
  messaging_product: Schema.Literal("whatsapp"),
  contacts: Schema.Array(Schema.Struct({ input: phone, wa_id: phone })).check(
    Schema.isLengthBetween(1, 1)
  ),
  messages: Schema.Array(Schema.Struct({ id: messageId })).check(
    Schema.isLengthBetween(1, 1)
  ),
});

const decodeEffect_receipt = Schema.decodeUnknownEffect(receipt);

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

const decodeEffect_downloadableMedia =
  Schema.decodeUnknownEffect(downloadableMedia);

const kapsoMediaIdMismatch = (metadataId: string, id: string) =>
  metadataId !== id;

const kapsoMediaTooLarge = (fileSize: string, maxBytes: number) =>
  Number(fileSize) > maxBytes;

const kapsoMediaBytesMismatch = (bytesLength: number, fileSize: string) =>
  bytesLength !== Number(fileSize);

const kapsoInvalidMedia = () =>
  new ChannelMediaError({ reason: "invalid_media" });

const kapsoDownloadFailed = () =>
  new ChannelMediaError({ reason: "download_failed" });

const kapsoWrongInstallationMedia = () =>
  new ChannelMediaError({ reason: "wrong_installation" });

const kapsoMediaTooLargeError = () =>
  new ChannelMediaError({ reason: "too_large" });

const requireKapsoInstallationMatch = (
  installationId: string,
  phoneNumberId: string
) => {
  if (phoneNumberId !== installationId) {
    return Effect.fail(kapsoWrongInstallationMedia());
  }

  return Effect.void;
};

const makeKapsoDownloadMedia = (http: HttpClient.HttpClient) =>
  Effect.fn("Kapso.downloadMedia")(function* (
    installationId: string,
    mediaId: string,
    maxBytes: number
  ) {
    const installation = yield* readInstallation;
    yield* requireKapsoInstallationMatch(
      installationId,
      installation.phoneNumberId
    );

    const id = yield* decodeEffect_phoneId(mediaId).pipe(
      Effect.mapError(kapsoInvalidMedia)
    );

    const key = yield* Config.redacted("KAPSO_API_KEY").pipe(
      Effect.mapError(kapsoDownloadFailed)
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
      Effect.flatMap(decodeEffect_downloadableMedia),
      Effect.mapError(kapsoDownloadFailed)
    );

    if (kapsoMediaIdMismatch(metadata.id, id)) {
      return yield* kapsoInvalidMedia();
    }

    if (kapsoMediaTooLarge(metadata.file_size, maxBytes)) {
      return yield* kapsoMediaTooLargeError();
    }

    // The provider-issued URL embeds its authorization. Never forward the API key.
    const bytes = yield* downloadMediaBytes(
      http,
      HttpClientRequest.get(metadata.download_url),
      maxBytes
    );

    if (kapsoMediaBytesMismatch(bytes.length, metadata.file_size)) {
      return yield* kapsoInvalidMedia();
    }

    return bytes;
  });

const makeKapso = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  const sendText = Effect.fn("Kapso.sendText")(function* (
    targetId: string,
    text: string,
    reply?: string
  ) {
    const input = yield* decodeSendInput({
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
      Effect.flatMap(decodeEffect_receipt),
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
    downloadMedia: makeKapsoDownloadMedia(http),
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
