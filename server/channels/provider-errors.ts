import { Effect, Option, Schema, Stream } from "effect";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  type HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";

const provider = Schema.Literals(["telegram", "kapso"]);

export class ProviderInputError extends Schema.TaggedError<ProviderInputError>()(
  "ProviderInputError",
  {
    provider,
    reason: Schema.Literals([
      "malformed",
      "configuration",
      "wrong_installation",
      "unsupported_identity",
      "invalid_command",
      "invalid_target",
      "stale_event",
      "future_event",
    ]),
  }
) {}

export class ProviderRejected extends Schema.TaggedError<ProviderRejected>()(
  "ProviderRejected",
  { provider, status: Schema.Int }
) {}

/** Definite rate-limit / flood-control rejection; safe to reschedule the same delivery. */
export class ProviderRetryable extends Schema.TaggedError<ProviderRetryable>()(
  "ProviderRetryable",
  {
    provider,
    status: Schema.Int,
    retryAfterSeconds: Schema.Int,
  }
) {}

// No request, response body, URL, token or raw exception may enter these errors.
export class ProviderUncertain extends Schema.TaggedError<ProviderUncertain>()(
  "ProviderUncertain",
  {
    provider,
    reason: Schema.Literals([
      "transport",
      "server_error",
      "unexpected_status",
      "malformed_receipt",
    ]),
  }
) {}

export const DEFAULT_RETRY_AFTER_SECONDS = 30;

export const MAX_RETRY_AFTER_SECONDS = 3_600;

/** Clamp provider delay into a bounded positive second count. */
export const boundRetryAfterSeconds = (raw: number | undefined): number => {
  if (raw === undefined || !Number.isFinite(raw) || raw < 1) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  return Math.min(Math.floor(raw), MAX_RETRY_AFTER_SECONDS);
};

/** Parse Retry-After as delta-seconds or HTTP-date; undefined when absent/malformed. */
function parseRetryAfterDeltaSeconds(trimmed: string): number | undefined {
  if (!/^\d+$/u.test(trimmed)) {
    return undefined;
  }

  const seconds = Number(trimmed);

  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function parseRetryAfterHttpDate(trimmed: string): number | undefined {
  const millis = Date.parse(trimmed);

  if (Number.isNaN(millis)) {
    return undefined;
  }

  return Math.ceil((millis - Date.now()) / 1_000);
}

/** Parse Retry-After as delta-seconds or HTTP-date; undefined when absent/malformed. */
export const parseRetryAfterHeader = (
  value: string | undefined
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > 64) {
    return undefined;
  }

  return (
    parseRetryAfterDeltaSeconds(trimmed) ?? parseRetryAfterHttpDate(trimmed)
  );
};

const telegramRetryAfterSchema = Schema.Struct({
  parameters: Schema.optionalKey(
    Schema.Struct({
      retry_after: Schema.optionalKey(Schema.Number),
    })
  ),
});

const decodeSchema_fromJsonString_telegramRetryAfterSchema =
  Schema.decodeUnknownOption(Schema.fromJsonString(telegramRetryAfterSchema));

const decodeSchema_fromJsonString_Schema_Json = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);

const readBoundedChunks = (
  response: HttpClientResponse.HttpClientResponse,
  channel: "telegram" | "kapso"
) =>
  response.stream.pipe(
    Stream.runFoldEffect(
      () => ({ size: 0, chunks: new Array<Uint8Array>() }),
      (state, chunk) => {
        if (state.size + chunk.length > 65_536) {
          return Effect.fail(
            new ProviderUncertain({
              provider: channel,
              reason: "malformed_receipt",
            })
          );
        }

        return Effect.sync(() => {
          state.size += chunk.length;
          state.chunks.push(chunk);

          return state;
        });
      }
    ),
    Effect.mapError(
      () =>
        new ProviderUncertain({
          provider: channel,
          reason: "malformed_receipt",
        })
    )
  );

const retryAfterFromBody = (text: string): number | undefined => {
  const decoded = decodeSchema_fromJsonString_telegramRetryAfterSchema(text);

  if (Option.isNone(decoded)) return undefined;
  // Schema.Number already established the domain value at the decode boundary.
  const value = decoded.value.parameters?.retry_after;

  return value !== undefined && Number.isFinite(value) ? value : undefined;
};

const resolveRetryAfterSeconds = Effect.fn("resolveRetryAfterSeconds")(
  function* (
    response: HttpClientResponse.HttpClientResponse,
    channel: "telegram" | "kapso"
  ) {
    const header = parseRetryAfterHeader(
      Option.getOrUndefined(Headers.get(response.headers, "retry-after"))
    );

    if (header !== undefined) return boundRetryAfterSeconds(header);

    const body = yield* readBoundedChunks(response, channel).pipe(
      Effect.catchTag("ProviderUncertain", () =>
        Effect.succeed({ size: 0, chunks: new Array<Uint8Array>() })
      )
    );

    if (body.size === 0) return DEFAULT_RETRY_AFTER_SECONDS;
    const text = Buffer.concat(body.chunks, body.size).toString("utf8");

    return boundRetryAfterSeconds(retryAfterFromBody(text));
  }
);

// Both adapters use the same conservative send boundary. Never retry this
// effect: even a transport failure may follow a successful external action.
// HTTP 429 is a definite rejection with a provider delay; the outbox schedules
// the next attempt instead of retrying inside this call.
const providerTransportUncertain = (channel: "telegram" | "kapso") =>
  new ProviderUncertain({ provider: channel, reason: "transport" });

const providerMalformedReceipt = (channel: "telegram" | "kapso") =>
  new ProviderUncertain({
    provider: channel,
    reason: "malformed_receipt",
  });

const isClientRejectStatus = (status: number) => {
  if (status < 400 || status >= 500) return false;

  return status !== 408;
};

const isUnexpectedHttpStatus = (status: number) => {
  if (status < 200) return true;

  return status >= 300;
};

const unexpectedStatusReason = (status: number) => {
  if (status >= 500) return "server_error" as const;

  return "unexpected_status" as const;
};

export const requestProviderJson = Effect.fn("requestProviderJson")(
  function* (
    client: HttpClient.HttpClient,
    channel: "telegram" | "kapso",
    request: HttpClientRequest.HttpClientRequest
  ) {
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError(() => providerTransportUncertain(channel)));

    if (response.status === 429) {
      const retryAfterSeconds = yield* resolveRetryAfterSeconds(
        response,
        channel
      );

      return yield* new ProviderRetryable({
        provider: channel,
        status: 429,
        retryAfterSeconds,
      });
    }

    if (isClientRejectStatus(response.status)) {
      return yield* new ProviderRejected({
        provider: channel,
        status: response.status,
      });
    }

    if (isUnexpectedHttpStatus(response.status)) {
      return yield* new ProviderUncertain({
        provider: channel,
        reason: unexpectedStatusReason(response.status),
      });
    }

    const body = yield* readBoundedChunks(response, channel);

    return yield* decodeSchema_fromJsonString_Schema_Json(
      Buffer.concat(body.chunks, body.size).toString("utf8")
    ).pipe(Effect.mapError(() => providerMalformedReceipt(channel)));
  },
  (operation, _client, channel) =>
    operation.pipe(
      Effect.timeout("15 seconds"),
      Effect.catchTag(
        "TimeoutError",
        () => new ProviderUncertain({ provider: channel, reason: "transport" })
      ),
      Effect.provideService(FetchHttpClient.RequestInit, {
        redirect: "manual",
      }),
      // Telegram credentials are part of its URL; disable HTTP URL/header spans.
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false)
    )
);
