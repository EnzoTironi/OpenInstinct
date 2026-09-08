import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { ConfigProvider, Effect, Schema } from "effect";
import { expect, test } from "vitest";
import {
  readVerifiedScheduledCallback,
  scheduledCallbackBodies,
  scheduledCallbackHeaders,
  scheduledCallbackOrigin,
} from "./scheduled-callback-auth";

const configuration = {
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const route = "/internal/scheduled-run/report";
const body = JSON.stringify({ runId: randomUUID() });
const run = <A, E>(
  effect: Effect.Effect<A, E>,
  config: Record<string, string> = configuration
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(config)
      )
    )
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
  const headers = await run(scheduledCallbackHeaders(route, body));
  const raw = await run(readVerifiedScheduledCallback(request(headers), route));
  expect(raw.toString()).toBe(body);
  // The public audience is configured; forwarded headers cannot change it.
  headers.set("x-forwarded-host", "untrusted.invalid");
  expect(
    (
      await run(readVerifiedScheduledCallback(request(headers), route))
    ).toString()
  ).toBe(body);
});

test("rejects absent, malformed and changed signatures and changed body/method/path/query", async () => {
  const headers = await run(scheduledCallbackHeaders(route, body));
  const absent = new Headers();
  const malformed = new Headers(headers);
  malformed.set("x-scheduled-callback-signature", "x");
  const wrong = new Headers(headers);
  wrong.set("x-scheduled-callback-signature", "00".repeat(32));
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
      run(readVerifiedScheduledCallback(input, route).pipe(Effect.flip))
    )
  );
  for (const result of results) expect(result.status).toBe(401);
});

test("rejects a signature transplanted between routes, audiences or installations", async () => {
  const headers = await run(scheduledCallbackHeaders(route, body));
  const respond = "/internal/scheduled-run/respond";
  expect(
    await run(
      readVerifiedScheduledCallback(
        request(headers, body, respond),
        respond
      ).pipe(Effect.flip)
    )
  ).toMatchObject({ status: 401 });
  expect(
    await run(
      readVerifiedScheduledCallback(request(headers), route).pipe(Effect.flip),
      {
        ...configuration,
        BETTER_AUTH_URL: "https://another-installation.invalid",
      }
    )
  ).toMatchObject({ status: 401 });
  expect(
    await run(
      readVerifiedScheduledCallback(request(headers), route).pipe(Effect.flip),
      {
        ...configuration,
        SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      }
    )
  ).toMatchObject({ status: 401 });
});

test("rejects correctly signed expired and far-future requests", async () => {
  const derivedKey = createHmac(
    "sha256",
    Buffer.from(configuration.SECRET_ENCRYPTION_KEY, "base64")
  )
    .update("companion/scheduled-callback/v1")
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
        "x-scheduled-callback-time": timestamp,
        "x-scheduled-callback-signature": signature,
      });
      expect(
        await run(
          readVerifiedScheduledCallback(request(headers), route).pipe(
            Effect.flip
          )
        )
      ).toMatchObject({ status: 401 });
    })
  );
});

test("requires explicit valid secret and restricts cleartext destinations to loopback", async () => {
  const configs = [
    { BETTER_AUTH_URL: configuration.BETTER_AUTH_URL },
    { ...configuration, SECRET_ENCRYPTION_KEY: "bad-key" },
    { ...configuration, BETTER_AUTH_URL: "http://remote.invalid" },
    { ...configuration, BETTER_AUTH_URL: "https://user:password@host.invalid" },
  ];
  await Promise.all(
    configs.map(async (config) => {
      expect(
        await run(
          scheduledCallbackHeaders(route, body).pipe(Effect.flip),
          config
        )
      ).toMatchObject({ status: 503 });
    })
  );
  expect(
    await run(scheduledCallbackOrigin, {
      ...configuration,
      BETTER_AUTH_URL: "https://host.invalid/path",
    })
  ).toBe("https://host.invalid");
});

test("limits streamed body bytes without trusting Content-Length", async () => {
  const oversized = "x".repeat(64 * 1024 + 1);
  const headers = await run(scheduledCallbackHeaders(route, oversized));
  headers.set("content-length", "1");
  expect(
    await run(
      readVerifiedScheduledCallback(request(headers, oversized), route).pipe(
        Effect.flip
      )
    )
  ).toMatchObject({ status: 413 });
});

test("signed malformed JSON and extra authority fields fail the boundary schema", async () => {
  await Promise.all(
    ["{", JSON.stringify({ runId: randomUUID(), userId: "other-user" })].map(
      async (payload) => {
        const headers = await run(scheduledCallbackHeaders(route, payload));
        const raw = await run(
          readVerifiedScheduledCallback(request(headers, payload), route)
        );
        const result = await run(
          Schema.decodeUnknownEffect(
            Schema.fromJsonString(scheduledCallbackBodies[route]),
            { onExcessProperty: "error" }
          )(raw.toString()).pipe(Effect.result)
        );
        expect(result).toMatchObject({ _tag: "Failure" });
      }
    )
  );
});

test("a valid retry remains authentic and must still pass the database claim", async () => {
  const headers = await run(scheduledCallbackHeaders(route, body));
  const results = await Promise.all(
    [1, 2].map(() =>
      run(readVerifiedScheduledCallback(request(headers), route))
    )
  );
  for (const result of results) expect(result.toString()).toBe(body);
});
