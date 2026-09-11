import { Effect, Schema, Stream } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
} from "effect/unstable/http";

import { ChannelMediaError } from "./policy";

const contentLength = Schema.String.check(Schema.isPattern(/^[0-9]+$/u));

const decodeEffect_contentLength = Schema.decodeUnknownEffect(contentLength);

const downloadFailed = () =>
  new ChannelMediaError({ reason: "download_failed" });

const tooLarge = () => new ChannelMediaError({ reason: "too_large" });

const emptyFoldState = () => ({ size: 0, chunks: new Array<Uint8Array>() });

const appendDownloadChunk = (
  state: { size: number; chunks: Uint8Array[] },
  chunk: Uint8Array,
  maxBytes: number
) => {
  if (state.size + chunk.length > maxBytes) return Effect.fail(tooLarge());
  state.size += chunk.length;
  state.chunks.push(chunk);

  return Effect.succeed(state);
};

const enforceDeclaredContentLength = (
  declared: string | undefined,
  maxBytes: number
) =>
  Effect.gen(function* () {
    if (declared === undefined) return;

    const length = yield* decodeEffect_contentLength(declared).pipe(
      Effect.mapError(downloadFailed)
    );

    if (Number(length) > maxBytes) {
      yield* tooLarge();
    }
  });

export const downloadMediaBytes = Effect.fn("downloadMediaBytes")(
  function* (
    client: HttpClient.HttpClient,
    request: HttpClientRequest.HttpClientRequest,
    maxBytes: number
  ) {
    const response = yield* HttpClient.withScope(client)
      .execute(request)
      .pipe(Effect.mapError(downloadFailed));

    if (response.status !== 200) return yield* downloadFailed();
    yield* enforceDeclaredContentLength(
      response.headers["content-length"],
      maxBytes
    );

    const body = yield* response.stream.pipe(
      Stream.mapError(downloadFailed),
      Stream.runFoldEffect(emptyFoldState, (state, chunk) =>
        appendDownloadChunk(state, chunk, maxBytes)
      )
    );

    return Buffer.concat(body.chunks, body.size);
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.catchTag("TimeoutError", downloadFailed),
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
  Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  Effect.provideService(HttpClient.TracerPropagationEnabled, false)
);
