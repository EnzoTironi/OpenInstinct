import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Schema } from "effect";
import type { RouteHandlerArgs } from "eve/channels";
import { afterAll, test, vi } from "vitest";
import { privateChannel } from "../../agent/lib/private-channel";
import { ChannelAccounts } from "../../server/accounts";
import { serverRuntime } from "../../server/runtime";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";

const telegramRequest = Schema.Struct({
  text: Schema.String,
  chat_id: Schema.optionalKey(Schema.String),
  message_id: Schema.optionalKey(Schema.Number),
  callback_query_id: Schema.optionalKey(Schema.String),
  show_alert: Schema.optionalKey(Schema.Boolean),
  reply_markup: Schema.optionalKey(
    Schema.Struct({
      inline_keyboard: Schema.Array(
        Schema.Array(
          Schema.Struct({
            text: Schema.String,
            callback_data: Schema.String,
          })
        )
      ),
    })
  ),
});

// The shared serverRuntime snapshots process.env on its first Config read and
// captures globalThis.fetch once, so every test in this file shares one Telegram
// installation and one provider HTTP stub, swapping only the handler.
const botId = String(randomInt(100_000_000, 999_999_999));
vi.stubEnv("TELEGRAM_BOT_ID", botId);
vi.stubEnv("TELEGRAM_BOT_USERNAME", "channel_test_bot");
vi.stubEnv("TELEGRAM_BOT_TOKEN", `${botId}:test_token`);
vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", randomBytes(32).toString("hex"));
let outbound: (request: Request) => Promise<Response> = () =>
  assert.fail("No outbound provider handler is installed");
vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
  outbound(new Request(input, init))
);

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("refused Telegram logins are acknowledged without blocking a fresh confirmation", async () => {
  const configuration = await serverRuntime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const rows = yield* sql<{
        name: string;
      }>`SELECT current_database() AS name`;
      assert.equal(rows[0]?.name, "companion_runtime_test");
      return yield* Config.all({
        installationId: Config.string("TELEGRAM_BOT_ID"),
        secret: Config.string("TELEGRAM_WEBHOOK_SECRET"),
      });
    })
  );
  const delivery: { method: string; body: typeof telegramRequest.Type }[] = [];
  let rejectNextAnswer = false;
  // Keep parsing, dispatch and storage real; replace only the external HTTP boundary.
  outbound = async (request) => {
    const url = new URL(request.url);
    assert.equal(url.origin, "https://api.telegram.org");
    const method = url.pathname.split("/").at(-1);
    assert.ok(method);
    const body = Schema.decodeUnknownSync(telegramRequest)(
      await request.json()
    );
    delivery.push({ method, body });
    if (method === "answerCallbackQuery") {
      if (rejectNextAnswer) {
        rejectNextAnswer = false;
        return Response.json({ ok: false, error_code: 400 }, { status: 400 });
      }
      return Response.json({ ok: true, result: true });
    }
    assert.ok(method === "sendMessage" || method === "editMessageText");
    return Response.json({
      ok: true,
      result: {
        message_id: body.message_id ?? delivery.length,
        chat: { id: Number(body.chat_id), type: "private" },
      },
    });
  };
  const senderId = randomInt(100_000_000, 999_999_999);
  const sender = {
    channel: "telegram" as const,
    installationId: configuration.installationId,
    senderId: String(senderId),
  };
  const identity = await serverRuntime.runPromise(linkedIdentity(sender));
  const challenges: string[] = [];
  const issue = () =>
    serverRuntime.runPromise(
      Effect.gen(function* () {
        const accounts = yield* ChannelAccounts;
        const challenge = yield* accounts.issueChallenge({
          purpose: "login",
          channel: "telegram",
          installationId: configuration.installationId,
          browserSecret: randomBytes(32).toString("base64url"),
        });
        challenges.push(challenge.challengeId);
        return challenge;
      })
    );
  const route = privateChannel("telegram").routes[0];
  assert.ok(route && route.transport !== "websocket");
  const background: Promise<unknown>[] = [];
  const context: RouteHandlerArgs = {
    from: () => assert.fail("Login commands must not start agent turns"),
    resolveSession: () =>
      assert.fail("Login commands do not resolve agent sessions"),
    attachSession: () =>
      assert.fail("Login commands do not attach agent sessions"),
    to: () => assert.fail("Login commands do not send agent messages"),
    params: {},
    requestIp: null,
    waitUntil: (task) => {
      background.push(task);
    },
  };
  let eventId = randomInt(100_000_000, 999_999_999);
  const request = (
    token: string,
    options: { confirm?: boolean; secret?: string; date?: number } = {}
  ) => {
    eventId += 1;
    const message = {
      message_id: eventId,
      date: options.date ?? Math.floor(Date.now() / 1000),
      from: { id: senderId, is_bot: false },
      chat: { id: senderId, type: "private" },
      text: `/start ${token}`,
    };
    const update = options.confirm
      ? {
          update_id: eventId,
          callback_query: {
            id: String(eventId),
            from: message.from,
            data: `confirm:${token}`,
            message: {
              ...message,
              from: { id: Number(configuration.installationId), is_bot: true },
              text: "Confirm sign-in",
            },
          },
        }
      : { update_id: eventId, message };
    return route.handler(
      new Request("http://localhost/channels/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token":
            options.secret ?? configuration.secret,
        },
        body: JSON.stringify(update),
      }),
      context
    );
  };
  try {
    const expired = await issue();
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${expired.challengeId}`;
      })
    );
    const refused = await Promise.all([
      request(expired.token),
      request(expired.token, { confirm: true }),
      request(randomBytes(32).toString("base64url")),
      request("malformed-token-123"),
      request("short"),
      request(expired.token, {
        confirm: true,
        date: Math.floor(Date.now() / 1000) - 172_800,
      }),
    ]);
    for (const response of refused) assert.equal(response.status, 200);
    await Promise.all(background);
    assert.ok(
      delivery.some(
        ({ method, body }) =>
          method === "answerCallbackQuery" &&
          body.show_alert === true &&
          body.text.includes("cannot be confirmed")
      )
    );
    assert.ok(
      delivery.some(
        ({ method, body }) =>
          method === "sendMessage" && body.text.includes("start a new request")
      )
    );
    assert.equal(
      delivery.some(({ method }) => method === "editMessageText"),
      false
    );
    assert.equal(
      delivery.filter(({ method }) => method === "answerCallbackQuery").length,
      2
    );
    const refusedDeliveryCount = delivery.length;
    assert.equal(
      (await request(expired.token, { secret: "wrong-secret" })).status,
      401
    );
    await Promise.all(background);
    assert.equal(delivery.length, refusedDeliveryCount);

    const fresh = await issue();
    assert.equal((await request(fresh.token)).status, 200);
    await Promise.all(background);
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const prompts = yield* sql<{
          status: string;
        }>`SELECT status FROM public.channel_auth_prompt WHERE challenge_id = ${fresh.challengeId}`;
        assert.deepEqual(prompts, [{ status: "sent" }]);
        const rejectedPrompts =
          yield* sql`SELECT challenge_id FROM public.channel_auth_prompt WHERE challenge_id = ${expired.challengeId}`;
        assert.equal(rejectedPrompts.length, 0);
      })
    );
    const prompt = delivery.find(({ body }) => Boolean(body.reply_markup));
    assert.ok(prompt);
    assert.match(prompt.body.text, /return to that tab to finish signing in/i);
    assert.deepEqual(prompt.body.reply_markup, {
      inline_keyboard: [
        [{ text: "Confirm sign-in", callback_data: `confirm:${fresh.token}` }],
      ],
    });
    // A late/rejected toast must neither undo confirmation nor prevent the visible edit.
    rejectNextAnswer = true;
    assert.equal((await request(fresh.token, { confirm: true })).status, 200);
    await Promise.all(background);
    const feedback = delivery.slice(-2);
    assert.deepEqual(
      feedback.map(({ method }) => method),
      ["answerCallbackQuery", "editMessageText"]
    );
    const [answer, edit] = feedback;
    assert.ok(answer && edit);
    assert.equal(answer.body.show_alert, false);
    assert.match(answer.body.text, /^Confirmed/);
    assert.deepEqual(edit.body.reply_markup, { inline_keyboard: [] });
    assert.match(edit.body.text, /browser tab where you started/);
    // A repeated tap from the same sender is an idempotent receipt, not a refusal.
    assert.equal((await request(fresh.token, { confirm: true })).status, 200);
    await Promise.all(background);
    const repeated = delivery.slice(-2);
    assert.deepEqual(
      repeated.map(({ method, body }) => [method, body.show_alert ?? null]),
      [
        ["answerCallbackQuery", false],
        ["editMessageText", null],
      ]
    );
    assert.match(repeated[0]?.body.text ?? "", /^Confirmed/);
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const rows = yield* sql<{
          confirmed: boolean;
        }>`SELECT confirmed_at IS NOT NULL AS confirmed FROM public.channel_auth_challenge WHERE id = ${expired.challengeId}`;
        assert.deepEqual(rows, [{ confirmed: false }]);
        const accepted = yield* sql<{
          senderId: string;
        }>`SELECT confirmed_sender_id AS "senderId" FROM public.channel_auth_challenge WHERE id = ${fresh.challengeId} AND confirmed_at IS NOT NULL`;
        assert.deepEqual(accepted, [{ senderId: sender.senderId }]);
      })
    );
  } finally {
    await Promise.all(background);
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM public.channel_auth_challenge WHERE id IN ${sql.in(challenges)}`;
        yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`;
        yield* sql`DELETE FROM public."user" WHERE id = ${identity.userId}`;
      })
    );
  }
});

test("an unknown Telegram sender is told to sign in once and never becomes a user", async () => {
  const secret = await serverRuntime.runPromise(
    Config.string("TELEGRAM_WEBHOOK_SECRET")
  );
  const delivery: { method: string; body: typeof telegramRequest.Type }[] = [];
  outbound = async (request) => {
    const url = new URL(request.url);
    assert.equal(url.origin, "https://api.telegram.org");
    const method = url.pathname.split("/").at(-1);
    assert.equal(method, "sendMessage");
    const body = Schema.decodeUnknownSync(telegramRequest)(
      await request.json()
    );
    delivery.push({ method, body });
    return Response.json({
      ok: true,
      result: {
        message_id: delivery.length,
        chat: { id: Number(body.chat_id), type: "private" },
      },
    });
  };
  const senderId = randomInt(100_000_000, 999_999_999);
  const route = privateChannel("telegram").routes[0];
  assert.ok(route && route.transport !== "websocket");
  const background: Promise<unknown>[] = [];
  const context: RouteHandlerArgs = {
    from: () => assert.fail("Unknown senders must not start agent turns"),
    resolveSession: () =>
      assert.fail("Unknown senders do not resolve agent sessions"),
    attachSession: () =>
      assert.fail("Unknown senders do not attach agent sessions"),
    to: () => assert.fail("Unknown senders do not receive agent messages"),
    params: {},
    requestIp: null,
    waitUntil: (task) => {
      background.push(task);
    },
  };
  let eventId = randomInt(100_000_000, 999_999_999);
  const message = (chat: { id: number; type: string }, text: string) => {
    eventId += 1;
    return route.handler(
      new Request("http://localhost/channels/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
        body: JSON.stringify({
          update_id: eventId,
          message: {
            message_id: eventId,
            date: Math.floor(Date.now() / 1000),
            from: { id: senderId, is_bot: false },
            chat,
            text,
          },
        }),
      }),
      context
    );
  };
  const observe = () =>
    serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const users = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user"`;
        const identities = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public.channel_identity
          WHERE channel = 'telegram' AND installation_id = ${botId} AND sender_id = ${String(senderId)}`;
        const pending = yield* sql<{
          contactCount: number;
        }>`SELECT contact_count AS "contactCount" FROM public.channel_pending_sender
          WHERE channel = 'telegram' AND installation_id = ${botId} AND sender_id = ${String(senderId)}`;
        return {
          users: users[0]?.count,
          identities: identities[0]?.count,
          pending,
        };
      })
    );
  try {
    const before = await observe();
    const group = await message(
      { id: -100_200_300, type: "supergroup" },
      "@channel_test_bot hello"
    );
    assert.equal(group.status, 200);
    await Promise.all(background);
    assert.equal(delivery.length, 0);
    assert.deepEqual(await observe(), {
      users: before.users,
      identities: 0,
      pending: [],
    });

    const first = await message({ id: senderId, type: "private" }, "hello");
    assert.equal(first.status, 200);
    await Promise.all(background);
    assert.equal(delivery.length, 1);
    const prompt = delivery[0];
    assert.ok(prompt);
    assert.equal(prompt.body.chat_id, String(senderId));
    assert.match(prompt.body.text, /\/sign-in/);
    assert.deepEqual(await observe(), {
      users: before.users,
      identities: 0,
      pending: [{ contactCount: 1 }],
    });

    const second = await message({ id: senderId, type: "private" }, "again");
    assert.equal(second.status, 200);
    await Promise.all(background);
    assert.equal(delivery.length, 1);
    assert.deepEqual(await observe(), {
      users: before.users,
      identities: 0,
      pending: [{ contactCount: 2 }],
    });
  } finally {
    await Promise.all(background);
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM public.channel_pending_sender WHERE channel = 'telegram' AND installation_id = ${botId} AND sender_id = ${String(senderId)}`;
      })
    );
  }
});
