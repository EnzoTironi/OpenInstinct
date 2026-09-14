import assert from "node:assert/strict";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema, Result } from "effect";
import type { RouteHandlerArgs } from "eve/channels";
import { test, vi } from "vitest";
import { privateChannel } from "../../agent/lib/private-channel";
import { ChannelAccounts } from "../../server/accounts";
import { serverRuntime } from "../../server/runtime";
import { accessScopeForUser } from "../../shared/identity/access-scope";

test("signed WhatsApp button confirms only its recipient and original browser without running the agent", async () => {
  const installationId = String(randomInt(100_000_000, 999_999_999));
  const senderId = `1555${String(randomInt(1000000, 9999999))}`;
  const secret = randomBytes(32).toString("hex");
  vi.stubEnv("KAPSO_PHONE_NUMBER_ID", installationId);
  vi.stubEnv("KAPSO_PHONE_NUMBER", "+15550001111");
  vi.stubEnv("KAPSO_API_KEY", "synthetic-kapso-key");
  vi.stubEnv("KAPSO_WEBHOOK_SECRET", secret);
  const bodySchema = Schema.Struct({
    to: Schema.String,
    type: Schema.Literals(["text", "interactive"]),
    interactive: Schema.optionalKey(
      Schema.Struct({
        type: Schema.Literal("button"),
        action: Schema.Struct({
          buttons: Schema.Array(
            Schema.Struct({
              type: Schema.Literal("reply"),
              reply: Schema.Struct({ id: Schema.String, title: Schema.String }),
            })
          ),
        }),
      })
    ),
  });
  const sent: (typeof bodySchema.Type)[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      assert.equal(
        request.url,
        `https://api.kapso.ai/meta/whatsapp/v24.0/${installationId}/messages`
      );
      const body = Schema.decodeUnknownSync(bodySchema)(await request.json());
      sent.push(body);
      return Response.json({
        messaging_product: "whatsapp",
        contacts: [{ input: body.to, wa_id: body.to }],
        messages: [{ id: `wamid.out-${String(sent.length)}` }],
      });
    }
  );
  const browserSecret = randomBytes(32).toString("base64url");
  const sender = { channel: "kapso" as const, installationId, senderId };
  const setup = await serverRuntime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const [database] = yield* sql<{
        name: string;
      }>`SELECT current_database() AS name`;
      assert.equal(database?.name, "companion_runtime_test");
      const accounts = yield* ChannelAccounts;
      const identity = yield* accounts.resolveVerifiedSender(sender);
      const challenge = yield* accounts.issueChallenge({
        ...sender,
        purpose: "login",
        browserSecret,
      });
      return { identity, challenge };
    })
  );
  const route = privateChannel("kapso").routes[0];
  assert.ok(route && route.transport !== "websocket");
  const background: Promise<unknown>[] = [];
  const context: RouteHandlerArgs = {
    from: () => assert.fail("Device authentication cannot start agent turns"),
    resolveSession: () =>
      assert.fail("Device authentication cannot resolve agent sessions"),
    attachSession: () =>
      assert.fail("Device authentication cannot attach agent sessions"),
    to: () => assert.fail("Device authentication cannot send agent messages"),
    params: {},
    requestIp: null,
    waitUntil: (task) => {
      background.push(task);
    },
  };
  const deliver = async (
    id: string,
    confirm = false,
    from = senderId,
    signingSecret = secret,
    origin = "cloud_api"
  ) => {
    const body = JSON.stringify({
      phone_number_id: installationId,
      conversation: { phone_number_id: installationId, phone_number: from },
      message: {
        id: `wamid.${id}`,
        from,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: confirm ? "interactive" : "text",
        text: { body: `/start ${setup.challenge.token}` },
        interactive: {
          type: "button_reply",
          button_reply: { id: `confirm:${setup.challenge.token}` },
        },
        kapso: { direction: "inbound", status: "received", origin },
      },
    });
    const response = await route.handler(
      new Request("http://localhost/channels/kapso", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": createHmac("sha256", signingSecret)
            .update(body)
            .digest("hex"),
        },
      }),
      context
    );
    await Promise.all(background);
    return response;
  };
  const status = () =>
    serverRuntime.runPromise(
      Effect.flatMap(ChannelAccounts, (accounts) =>
        accounts.getChallengeStatus({
          challengeId: setup.challenge.challengeId,
          browserSecret,
        })
      )
    );
  try {
    assert.equal((await deliver("start")).status, 200);
    assert.equal((await deliver("start")).status, 200);
    assert.equal(
      sent.filter((message) => message.type === "interactive").length,
      1
    );
    assert.deepEqual(sent[0]?.interactive?.action.buttons, [
      {
        type: "reply",
        reply: {
          id: `confirm:${setup.challenge.token}`,
          title: "Confirmar entrada",
        },
      },
    ]);
    assert.equal(sent[0].to, senderId);
    assert.deepEqual(await status(), { status: "pending" });
    assert.equal(
      (await deliver("forged", true, senderId, "wrong-secret")).status,
      401
    );
    assert.equal(
      (await deliver("history", true, senderId, secret, "history_sync")).status,
      200
    );
    assert.equal((await deliver("forwarded", true, "15550003333")).status, 200);
    assert.deepEqual(await status(), { status: "pending" });
    assert.equal((await deliver("confirm", true)).status, 200);
    assert.deepEqual(await status(), { status: "confirmed" });
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const accounts = yield* ChannelAccounts;
        const wrongBrowser = yield* accounts
          .consumeChallenge({
            challengeId: setup.challenge.challengeId,
            browserSecret: "a-different-browser",
          })
          .pipe(Effect.result);
        assert.equal(Result.isFailure(wrongBrowser), true);
        const owner = yield* accounts.consumeChallenge({
          challengeId: setup.challenge.challengeId,
          browserSecret,
        });
        assert.equal(owner.userId, setup.identity.userId);
      })
    );
    assert.equal((await deliver("replay", true)).status, 200);
    assert.deepEqual(await status(), { status: "consumed" });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`;
        yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`;
        yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${setup.identity.userId}`).workspaceId}`;
        yield* sql`DELETE FROM public.user WHERE id = ${setup.identity.userId}`;
      })
    );
  }
});
