import { createHmac, timingSafeEqual } from "node:crypto";
import { Effect, Redacted, Schema, Stream } from "effect";
import type { channelProviderSchema } from "@shared/identity/channel-auth";

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

export const readVerifiedWebhook = Effect.fn("readVerifiedWebhook")(function* (
  request: Request,
  channel: typeof channelProviderSchema.Type,
  secret: Redacted.Redacted
) {
  if (Redacted.value(secret).length === 0) {
    return yield* new WebhookRejected({ status: 401 });
  }
  if (
    channel === "telegram" &&
    !matchesSecret(
      request.headers.get("x-telegram-bot-api-secret-token") ?? "",
      Redacted.value(secret)
    )
  ) {
    return yield* new WebhookRejected({ status: 401 });
  }

  const source = request.body;
  if (!source) return yield* new WebhookRejected({ status: 400 });
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
      (acc, chunk) =>
        acc.size + chunk.length > maximumBodyBytes
          ? Effect.fail(new WebhookRejected({ status: 413 }))
          : Effect.sync(() => {
              acc.size += chunk.length;
              acc.chunks.push(chunk);
              return acc;
            })
    ),
    Effect.timeout("5 seconds"),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new WebhookRejected({ status: 408 }))
    ),
    Effect.ensuring(cancelBody)
  );
  const body = Buffer.concat(received.chunks, received.size);

  if (
    channel === "kapso" &&
    !matchesSecret(
      request.headers.get("x-webhook-signature") ?? "",
      createHmac("sha256", Redacted.value(secret)).update(body).digest("hex")
    )
  ) {
    return yield* new WebhookRejected({ status: 401 });
  }

  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
    body.toString("utf8")
  ).pipe(Effect.mapError(() => new WebhookRejected({ status: 400 })));
});
