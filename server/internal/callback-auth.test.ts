import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { expect, test } from "vitest";
import {
  readVerifiedInternalCallback,
  internalCallbackBodies,
  internalCallbackHeaders,
  internalCallbackOrigin,
} from "./callback-auth";

const configuration = {
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const unusedBetterAuthSecret = randomBytes(32).toString("base64");
const route = "/internal/scheduled-run/report";
const body = JSON.stringify({ runId: randomUUID() });
const secretsLayer = (secretEncryptionKey: string) =>
  ResolvedInstallationSecrets.layerFromResolved({
    betterAuthSecret: unusedBetterAuthSecret,
    secretEncryptionKey,
  });
const run = <A, E>(
  effect: Effect.Effect<A, E, ResolvedInstallationSecrets>,
  config: Record<string, string> = configuration,
  secrets: Layer.Layer<ResolvedInstallationSecrets> = secretsLayer(
    configuration.SECRET_ENCRYPTION_KEY
  )
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(secrets),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(config)
      )
    ) as Effect.Effect<A, E>
  );

function request(
  headers: Headers,
  payload = body,
  path = route,
  method: "POST" | "PUT" = "POST"
) {
  return new Request(`http://127.0.0.1:4274${path}`, {
    method,
    headers,
    body: payload,
  });
}

test("authenticates raw bytes through a proxy with a different internal host", async () => {
  const headers = await run(internalCallbackHeaders(route, body));
  const raw = await run(readVerifiedInternalCallback(request(headers), route));
  expect(raw.toString()).toBe(body);
  // The public audience is configured; forwarded headers cannot change it.
  headers.set("x-forwarded-host", "untrusted.invalid");
  expect(
    (
      await run(readVerifiedInternalCallback(request(headers), route))
    ).toString()
  ).toBe(body);
});

test("rejects absent, malformed and changed signatures and changed body/method/path/query", async () => {
  const headers = await run(internalCallbackHeaders(route, body));
  const absent = new Headers();
  const malformed = new Headers(headers);
  malformed.set("x-internal-callback-signature", "x");
  const wrong = new Headers(headers);
  wrong.set("x-internal-callback-signature", "00".repeat(32));
  const inputs = [
    request(absent),
    request(malformed),
    request(wrong),
    request(headers, `${body} `),
    request(headers, body, route, "PUT"),
    request(headers, body, `${route}?extra=1`),
    request(headers, body, "/internal/scheduled-run/respond"),
  ];
  const results = await Promise.all(
    inputs.map((input) =>
      run(readVerifiedInternalCallback(input, route).pipe(Effect.flip))
    )
  );
  for (const result of results) expect(result.status).toBe(401);
});

test("rejects a signature transplanted between routes, audiences or installations", async () => {
  const headers = await run(internalCallbackHeaders(route, body));
  const respond = "/internal/scheduled-run/respond";
  expect(
    await run(
      readVerifiedInternalCallback(
        request(headers, body, respond),
        respond
      ).pipe(Effect.flip)
    )
  ).toMatchObject({ status: 401 });
  expect(
    await run(
      readVerifiedInternalCallback(request(headers), route).pipe(Effect.flip),
      {
        ...configuration,
        BETTER_AUTH_URL: "https://another-installation.invalid",
      }
    )
  ).toMatchObject({ status: 401 });
  expect(
    await run(
      readVerifiedInternalCallback(request(headers), route).pipe(Effect.flip),
      configuration,
      secretsLayer(randomBytes(32).toString("base64"))
    )
  ).toMatchObject({ status: 401 });
});

test("rejects correctly signed expired and far-future requests", async () => {
  const derivedKey = createHmac(
    "sha256",
    Buffer.from(configuration.SECRET_ENCRYPTION_KEY, "base64")
  )
    .update("companion/internal-callback/v1")
    .digest();
  await Promise.all(
    [-120, 120].map(async (offset) => {
      const timestamp = String(Math.floor(Date.now() / 1000) + offset);
      const signature = createHmac("sha256", derivedKey)
        .update(
          JSON.stringify([
            "v1",
            configuration.BETTER_AUTH_URL,
            "POST",
            route,
            timestamp,
            createHash("sha256").update(body).digest("hex"),
          ])
        )
        .digest("hex");
      const headers = new Headers({
        "x-internal-callback-time": timestamp,
        "x-internal-callback-signature": signature,
      });
      expect(
        await run(
          readVerifiedInternalCallback(request(headers), route).pipe(
            Effect.flip
          )
        )
      ).toMatchObject({ status: 401 });
    })
  );
});

test("requires explicit valid secret and restricts cleartext destinations to loopback", async () => {
  expect(
    await run(
      internalCallbackHeaders(route, body).pipe(Effect.flip),
      configuration,
      secretsLayer("bad-key")
    )
  ).toMatchObject({ status: 503 });
  for (const config of [
    { ...configuration, BETTER_AUTH_URL: "http://remote.invalid" },
    { ...configuration, BETTER_AUTH_URL: "https://user:password@host.invalid" },
  ]) {
    expect(
      await run(internalCallbackHeaders(route, body).pipe(Effect.flip), config)
    ).toMatchObject({ status: 503 });
  }
  expect(
    await run(internalCallbackOrigin, {
      ...configuration,
      BETTER_AUTH_URL: "https://host.invalid/path",
    })
  ).toBe("https://host.invalid");
});

test("limits streamed body bytes without trusting Content-Length", async () => {
  const oversized = "x".repeat(64 * 1024 + 1);
  const headers = await run(internalCallbackHeaders(route, oversized));
  headers.set("content-length", "1");
  expect(
    await run(
      readVerifiedInternalCallback(request(headers, oversized), route).pipe(
        Effect.flip
      )
    )
  ).toMatchObject({ status: 413 });
});

test("signed malformed JSON and extra authority fields fail the boundary schema", async () => {
  await Promise.all(
    ["{", JSON.stringify({ runId: randomUUID(), userId: "other-user" })].map(
      async (payload) => {
        const headers = await run(internalCallbackHeaders(route, payload));
        const raw = await run(
          readVerifiedInternalCallback(request(headers, payload), route)
        );
        const result = await run(
          Schema.decodeUnknownEffect(
            Schema.fromJsonString(internalCallbackBodies[route]),
            { onExcessProperty: "error" }
          )(raw.toString()).pipe(Effect.result)
        );
        expect(result).toMatchObject({ _tag: "Failure" });
      }
    )
  );
});

test("a valid retry remains authentic and must still pass the database claim", async () => {
  const headers = await run(internalCallbackHeaders(route, body));
  const results = await Promise.all(
    [1, 2].map(() => run(readVerifiedInternalCallback(request(headers), route)))
  );
  for (const result of results) expect(result.toString()).toBe(body);
});
