import assert from "node:assert/strict";
// oxlint-disable-next-line vitest/no-import-node-test -- This isolated package uses the Node runner.
import { test } from "node:test";
import { ConfigProvider, Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { reconcileChannelWebhooks } from "../webhooks.ts";

const input = {
  baseUrl: "https://zoen.example.com",
  legacyBaseUrl: "https://companion.example.com",
  machine: "web",
  release: "sha256:release",
  credentialVersion: "digest",
};
const config = ConfigProvider.fromEnvRecord({
  TELEGRAM_BOT_TOKEN: "synthetic-token",
  TELEGRAM_WEBHOOK_SECRET: "synthetic-secret",
  KAPSO_PHONE_NUMBER_ID: "12345",
  KAPSO_API_KEY: "synthetic-key",
  KAPSO_WEBHOOK_SECRET: "synthetic-secret",
});
const patchSchema = Schema.Struct({
  whatsapp_webhook: Schema.Struct({
    url: Schema.String,
    secret_key: Schema.String,
    active: Schema.Boolean,
    events: Schema.Array(Schema.String),
    buffer_enabled: Schema.Boolean,
    payload_version: Schema.String,
  }),
});

function webhookApi() {
  let telegram = `${input.legacyBaseUrl}/api/channels/telegram`;
  let hook = {
    id: "owned-hook",
    url: `${input.legacyBaseUrl}/api/channels/kapso`,
    active: true,
    secret_key: "old-secret",
    events: ["whatsapp.message.received"],
  };
  const writes: string[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const request = new Request(url, init);
    if (request.url.endsWith("/health"))
      return Response.json({ ok: true, status: "ready" });
    if (request.url.endsWith("/getWebhookInfo"))
      return Response.json({ ok: true, result: { url: telegram } });
    if (request.url.endsWith("/setWebhook")) {
      const body = Schema.decodeUnknownSync(
        Schema.Struct({
          url: Schema.String,
          drop_pending_updates: Schema.Boolean,
          secret_token: Schema.String,
        })
      )(await request.json());
      assert.equal(body.drop_pending_updates, false);
      assert.equal(body.secret_token, "synthetic-secret");
      telegram = body.url;
    } else if (request.method === "PATCH") {
      assert.ok(request.url.endsWith("/webhooks/owned-hook"));
      assert.equal(request.headers.get("X-API-Key"), "synthetic-key");
      const body = Schema.decodeUnknownSync(patchSchema)(await request.json());
      assert.equal(body.whatsapp_webhook.payload_version, "v2");
      assert.equal(body.whatsapp_webhook.buffer_enabled, false);
      hook = {
        ...hook,
        ...body.whatsapp_webhook,
        events: [...body.whatsapp_webhook.events],
      };
    } else {
      assert.equal(request.method, "GET");
      return Response.json({ data: [hook] });
    }
    writes.push(request.method);
    return Response.json(
      request.url.endsWith("/setWebhook")
        ? { ok: true, result: true }
        : { data: hook }
    );
  };
  const run = (transport = fetch) =>
    Effect.runPromise(
      reconcileChannelWebhooks(input).pipe(
        Effect.provide(ConfigProvider.layer(config)),
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, transport)
      )
    );
  return {
    run,
    fetch,
    writes,
    setTelegram: (url: string) => {
      telegram = url;
    },
  };
}

void test("reconciles owned webhooks, preserves pending updates and verifies readback without duplicate subscriptions", async () => {
  const api = webhookApi();
  const expected = {
    telegram: `${input.baseUrl}/api/channels/telegram`,
    whatsapp: `${input.baseUrl}/api/channels/kapso`,
    release: input.release,
  };
  assert.deepEqual(await api.run(), expected);
  assert.deepEqual(await api.run(), expected);
  assert.deepEqual(api.writes, ["POST", "PATCH", "POST", "PATCH"]);
  assert.doesNotMatch(
    JSON.stringify(expected),
    /synthetic-(secret|key|token)/u
  );
});

void test("refuses to take over another installation's Telegram webhook", async () => {
  const api = webhookApi();
  api.setTelegram("https://other.example.com/webhook");
  await assert.rejects(api.run(), /belongs to another installation/u);
  assert.deepEqual(api.writes, []);
});

void test("provider failures cannot disclose credential-bearing requests or error bodies", async () => {
  const api = webhookApi();
  await assert.rejects(
    api.run(async (url, init) => {
      if (new Request(url, init).url.endsWith("/setWebhook"))
        throw new Error("synthetic-token synthetic-secret synthetic-key");
      return api.fetch(url, init);
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Telegram webhook update failed/u);
      assert.doesNotMatch(error.message, /synthetic-/u);
      return true;
    }
  );
});

void test("a successful update response does not replace a readback check", async () => {
  const api = webhookApi();
  await assert.rejects(
    api.run(async (url, init) => {
      if (new Request(url, init).url.endsWith("/setWebhook"))
        return Response.json({ ok: true, result: true });
      return api.fetch(url, init);
    }),
    /readback does not match/u
  );
});
