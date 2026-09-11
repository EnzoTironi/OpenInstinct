import { createHmac, timingSafeEqual } from "node:crypto";

import type { channelProviderSchema } from "@shared/identity/channel-auth";
import { Effect, Redacted, Schema, Stream } from "effect";

const decodeSchema_fromJsonString_Schema_Json = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);

const maximumBodyBytes = 256 * 1024;

class WebhookRejected extends Schema.TaggedError<WebhookRejected>()(
  "WebhookRejected",
  { status: Schema.Literals([400, 401, 413, 408]) }
) {}

const matchesSecret = (received: string, expected: string) => {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);

  return (
    right.length > 0 &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
};

const rejectUnauthorizedTelegram = (
  request: Request,
  secret: Redacted.Redacted
) => {
  if (
    matchesSecret(
      request.headers.get("x-telegram-bot-api-secret-token") ?? "",
      Redacted.value(secret)
    )
  ) {
    return Effect.void;
  }

  return Effect.fail(new WebhookRejected({ status: 401 }));
};

const rejectUnauthorizedKapso = (
  request: Request,
  secret: Redacted.Redacted,
  body: Buffer
) => {
  if (
    matchesSecret(
      request.headers.get("x-webhook-signature") ?? "",
      createHmac("sha256", Redacted.value(secret)).update(body).digest("hex")
    )
  ) {
    return Effect.void;
  }

  return Effect.fail(new WebhookRejected({ status: 401 }));
};

const appendBodyChunk = (
  acc: { size: number; chunks: Uint8Array[] },
  chunk: Uint8Array
) => {
  if (acc.size + chunk.length > maximumBodyBytes) {
    return Effect.fail(new WebhookRejected({ status: 413 }));
  }

  return Effect.sync(() => {
    acc.size += chunk.length;
    acc.chunks.push(chunk);

    return acc;
  });
};

const readWebhookBody = Effect.fn("readWebhookBody")(function* (
  source: ReadableStream<Uint8Array>
) {
  const cancelBody = Effect.tryPromise({
    try: () => source.cancel(),
    catch: () => new WebhookRejected({ status: 400 }),
  }).pipe(Effect.interruptible, Effect.timeout("100 millis"), Effect.ignore);

  const received = yield* Stream.fromReadableStream({
    evaluate: () => source,
    onError: () => new WebhookRejected({ status: 400 }),
    releaseLockOnEnd: true,
  }).pipe(
    Stream.runFoldEffect(
      () => ({ size: 0, chunks: new Array<Uint8Array>() }),
      appendBodyChunk
    ),
    Effect.timeout("5 seconds"),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new WebhookRejected({ status: 408 }))
    ),
    Effect.ensuring(cancelBody)
  );

  return Buffer.concat(received.chunks, received.size);
});

export const readVerifiedWebhook = Effect.fn("readVerifiedWebhook")(function* (
  request: Request,
  channel: typeof channelProviderSchema.Type,
  secret: Redacted.Redacted
) {
  if (Redacted.value(secret).length === 0) {
    return yield* new WebhookRejected({ status: 401 });
  }

  if (channel === "telegram") {
    yield* rejectUnauthorizedTelegram(request, secret);
  }

  const source = request.body;

  if (!source) return yield* new WebhookRejected({ status: 400 });

  const body = yield* readWebhookBody(source);

  if (channel === "kapso") {
    yield* rejectUnauthorizedKapso(request, secret, body);
  }

  return yield* decodeSchema_fromJsonString_Schema_Json(
    body.toString("utf8")
  ).pipe(Effect.mapError(() => new WebhookRejected({ status: 400 })));
});
