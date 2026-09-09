import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Effect, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import {
  boundRetryAfterSeconds,
  DEFAULT_RETRY_AFTER_SECONDS,
  MAX_RETRY_AFTER_SECONDS,
  parseRetryAfterHeader,
  ProviderRejected,
  ProviderRetryable,
  ProviderUncertain,
  requestProviderJson,
} from "./provider-errors";

function fixtureUrl(server: Server, path = "/send") {
  const address = Schema.decodeUnknownSync(
    Schema.Struct({ port: Schema.Number })
  )(server.address());
  return `http://127.0.0.1:${String(address.port)}${path}`;
}

const call = (url: string) =>
  Effect.gen(function* () {
    return yield* requestProviderJson(
      yield* HttpClient.HttpClient,
      "telegram",
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.bodyJsonUnsafe({ text: "hello" })
      )
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));

describe("retry_after parsing", () => {
  it("bounds missing and malformed delays to the default", () => {
    expect(boundRetryAfterSeconds(undefined)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(boundRetryAfterSeconds(Number.NaN)).toBe(
      DEFAULT_RETRY_AFTER_SECONDS
    );
    expect(boundRetryAfterSeconds(0)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(boundRetryAfterSeconds(-3)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(parseRetryAfterHeader(undefined)).toBeUndefined();
    expect(parseRetryAfterHeader("")).toBeUndefined();
    expect(parseRetryAfterHeader("not-a-delay")).toBeUndefined();
  });

  it("accepts delta-seconds and clamps the upper bound", () => {
    expect(parseRetryAfterHeader("42")).toBe(42);
    expect(boundRetryAfterSeconds(42)).toBe(42);
    expect(boundRetryAfterSeconds(MAX_RETRY_AFTER_SECONDS + 10)).toBe(
      MAX_RETRY_AFTER_SECONDS
    );
  });
});

describe("requestProviderJson status classification", () => {
  it("treats HTTP 429 with Retry-After as ProviderRetryable", async () => {
    await using server = createServer((_request, response) => {
      response.writeHead(429, { "retry-after": "17" });
      response.end(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 17 },
        })
      );
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    await expect(
      Effect.runPromise(call(fixtureUrl(server)))
    ).rejects.toMatchObject({
      _tag: "ProviderRetryable",
      status: 429,
      retryAfterSeconds: 17,
      provider: "telegram",
    });
  });

  it("defaults retry_after when the header is missing and body has no delay", async () => {
    await using server = createServer((_request, response) => {
      response.writeHead(429);
      response.end(JSON.stringify({ ok: false, error_code: 429 }));
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const error = await Effect.runPromise(
      call(fixtureUrl(server)).pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(ProviderRetryable);
    expect(error).toMatchObject({
      status: 429,
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
  });

  it("reads parameters.retry_after from the body when the header is absent", async () => {
    await using server = createServer((_request, response) => {
      response.writeHead(429);
      response.end(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 9 },
        })
      );
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    await expect(
      Effect.runPromise(call(fixtureUrl(server)))
    ).rejects.toMatchObject({
      _tag: "ProviderRetryable",
      retryAfterSeconds: 9,
    });
  });

  it("defaults when Retry-After is malformed", async () => {
    await using server = createServer((_request, response) => {
      response.writeHead(429, { "retry-after": "soon-please" });
      response.end("{}");
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    await expect(
      Effect.runPromise(call(fixtureUrl(server)))
    ).rejects.toMatchObject({
      _tag: "ProviderRetryable",
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
  });

  it("keeps permanent 4xx as ProviderRejected", async () => {
    await using server = createServer((_request, response) => {
      response.writeHead(400);
      response.end("bad");
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const error = await Effect.runPromise(
      call(fixtureUrl(server)).pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(ProviderRejected);
    expect(error).toMatchObject({ status: 400 });
  });

  it("keeps 408 and 5xx as ProviderUncertain", async () => {
    for (const status of [408, 503] as const) {
      await using server = createServer((_request, response) => {
        response.writeHead(status);
        response.end("later");
      }).listen(0, "127.0.0.1");
      await once(server, "listening");
      const error = await Effect.runPromise(
        call(fixtureUrl(server)).pipe(Effect.flip)
      );
      expect(error).toBeInstanceOf(ProviderUncertain);
    }
  });
});
