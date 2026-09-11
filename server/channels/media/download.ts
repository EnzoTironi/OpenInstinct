import { Effect, Schema, Stream } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
} from "effect/unstable/http";

import { ChannelMediaError } from "./policy";

const contentLength = Schema.String.check(Schema.isPattern(/^[0-9]+$/u));

export const downloadMediaBytes = Effect.fn("downloadMediaBytes")(
  function* (
    client: HttpClient.HttpClient,
    request: HttpClientRequest.HttpClientRequest,
    maxBytes: number
  ) {
    const response = yield* HttpClient.withScope(client)
      .execute(request)
      .pipe(
        Effect.mapError(
          () => new ChannelMediaError({ reason: "download_failed" })
        )
      );

    if (response.status !== 200)
      return yield* new ChannelMediaError({ reason: "download_failed" });
    const declared = response.headers["content-length"];

    if (declared !== undefined) {
      const length = yield* Schema.decodeUnknownEffect(contentLength)(
        declared
      ).pipe(
        Effect.mapError(
          () => new ChannelMediaError({ reason: "download_failed" })
        )
      );

      if (Number(length) > maxBytes)
        return yield* new ChannelMediaError({ reason: "too_large" });
    }

    const body = yield* response.stream.pipe(
      Stream.mapError(
        () => new ChannelMediaError({ reason: "download_failed" })
      ),
      Stream.runFoldEffect(
        () => ({ size: 0, chunks: new Array<Uint8Array>() }),
        (state, chunk) => {
          if (state.size + chunk.length > maxBytes)
            return Effect.fail(new ChannelMediaError({ reason: "too_large" }));
          state.size += chunk.length;
          state.chunks.push(chunk);

          return Effect.succeed(state);
        }
      )
    );

    return Buffer.concat(body.chunks, body.size);
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.catchTag(
    "TimeoutError",
    () => new ChannelMediaError({ reason: "download_failed" })
  ),
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
  Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  Effect.provideService(HttpClient.TracerPropagationEnabled, false)
);
