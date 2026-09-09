import { Effect, Schema, Stream } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
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

// Both adapters use the same conservative send boundary. Never retry this
// effect: even a transport failure may follow a successful external action.
export const requestProviderJson = Effect.fn("requestProviderJson")(
  function* (
    client: HttpClient.HttpClient,
    channel: "telegram" | "kapso",
    request: HttpClientRequest.HttpClientRequest
  ) {
    const response = yield* client
      .execute(request)
      .pipe(
        Effect.mapError(
          () =>
            new ProviderUncertain({ provider: channel, reason: "transport" })
        )
      );
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408
    ) {
      return yield* new ProviderRejected({
        provider: channel,
        status: response.status,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* new ProviderUncertain({
        provider: channel,
        reason: response.status >= 500 ? "server_error" : "unexpected_status",
      });
    }
    const body = yield* response.stream.pipe(
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
    return yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Json)
    )(Buffer.concat(body.chunks, body.size).toString("utf8")).pipe(
      Effect.mapError(
        () =>
          new ProviderUncertain({
            provider: channel,
            reason: "malformed_receipt",
          })
      )
    );
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
