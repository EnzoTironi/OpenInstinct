import { NativeDeviceAuth } from "../../server/accounts/device";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { betterAuth } from "better-auth";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import {
  Config,
  ConfigProvider,
  Schema,
  Effect,
  Layer,
  ManagedRuntime,
} from "effect";
import { Pool } from "pg";
import { test, vi } from "vitest";
import { channelAuthorizationPollIntervalMs } from "../../web/auth/channel/client";
import {
  channelChallengeSchema,
  type channelChallengeIdSchema,
  type channelChallengeRequestSchema,
} from "../../shared/identity/channel-auth.ts";
import { ChannelAccounts } from "../../server/accounts/index.ts";
import { channelAuthPlugin } from "../../server/channel-auth/index.ts";

import { runtimeDatabase } from "./database";
import { linkedIdentity } from "./identity-fixture";

const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

test("real BetterAuth router, signed browser challenge and database session", async () => {
  const url = await Effect.runPromise(
    Config.string("DATABASE_URL").pipe(Effect.provide(runtimeDatabase))
  );
  const secret = randomBytes(32).toString("base64url");
  const runtime = ManagedRuntime.make(
    NativeDeviceAuth.layer.pipe(
      Layer.provideMerge(ChannelAccounts.layer),
      Layer.provideMerge(
        ResolvedInstallationSecrets.layerFromResolved({
          betterAuthSecret: secret,
          secretEncryptionKey: randomBytes(32).toString("base64"),
        })
      ),
      Layer.provideMerge(runtimeDatabase)
    )
  );
  const pool = new Pool({ connectionString: url });
  const installationId = `plugin-test-${randomUUID()}`;
  const baseURL = "http://localhost:3000";
  let configuration = ConfigProvider.fromUnknown({
    TELEGRAM_BOT_ID: installationId,
    TELEGRAM_BOT_USERNAME: "channel_test_bot",
  });
  const auth = betterAuth({
    baseURL,
    database: pool,
    secret,
    trustedOrigins: [baseURL],
    rateLimit: { enabled: true },
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    plugins: [
      channelAuthPlugin((program) =>
        runtime.runPromise(
          program.pipe(
            Effect.provideService(ConfigProvider.ConfigProvider, configuration)
          )
        )
      ),
    ],
  });
  const request = (
    path: string,
    method: string,
    cookie = "",
    body?:
      | typeof channelChallengeIdSchema.Type
      | typeof channelChallengeRequestSchema.Type,
    origin = baseURL
  ) => {
    const headers = new Headers({ origin });
    if (cookie) headers.set("cookie", cookie);
    const init: RequestInit = { method, headers };
    if (body) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }
    return auth.handler(new Request(`${baseURL}/api/auth${path}`, init));
  };
  const userIds = new Set<string>();
  try {
    const unavailable = await request("/channel-auth/start", "POST", "", {
      channel: "kapso",
      purpose: "login",
    });
    assert.equal(unavailable.status, 503);
    const forbidden = await request(
      "/channel-auth/start",
      "POST",
      "",
      { channel: "telegram", purpose: "login" },
      "https://attacker.invalid"
    );
    assert.equal(forbidden.status, 403);
    const noSession = await request("/channel-auth/start", "POST", "", {
      channel: "telegram",
      purpose: "link",
    });
    assert.equal(noSession.status, 401);
    const started = await request("/channel-auth/start", "POST", "", {
      channel: "telegram",
      purpose: "login",
    });
    assert.equal(started.status, 200);
    const challenge = Schema.decodeUnknownSync(channelChallengeSchema)(
      await started.json()
    );
    assert.equal(challenge.channel, "telegram");
    assert.equal(Object.hasOwn(challenge, "token"), false);
    const token = new URL(challenge.deepLink).searchParams.get("start");
    assert.ok(token);
    assert.equal(token.length, 43);
    const browser = cookieHeader(started);
    const setCookie = started.headers.getSetCookie()[0];
    assert.ok(setCookie);
    assert.match(setCookie, /HttpOnly/iu);
    assert.match(setCookie, /SameSite=Lax/iu);
    assert.match(setCookie, /Path=\/api\/auth\/channel-auth/iu);
    assert.match(setCookie, /Max-Age=600/iu);
    const noBrowser = await request(
      `/channel-auth/status?id=${challenge.id}`,
      "GET"
    );
    assert.equal(noBrowser.status, 400);
    const tampered = await request(
      `/channel-auth/status?id=${challenge.id}`,
      "GET",
      `${browser}x`
    );
    assert.equal(tampered.status, 400);
    const pending = await request(
      `/channel-auth/status?id=${challenge.id}`,
      "GET",
      browser
    );
    assert.deepEqual(await pending.json(), { status: "pending" });
    assert.equal(pending.headers.get("cache-control"), "no-store");
    const waitingSince = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (
        let at = waitingSince;
        at < Date.parse(challenge.expiresAt);
        at += channelAuthorizationPollIntervalMs
      ) {
        vi.setSystemTime(at);
        // oxlint-disable-next-line no-await-in-loop -- Finish each request before advancing the rate-limit clock.
        const waiting = await request(
          `/channel-auth/status?id=${challenge.id}`,
          "GET",
          browser
        );
        assert.equal(
          waiting.status,
          200,
          "Waiting for confirmation must not exhaust the authentication budget"
        );
      }
    } finally {
      vi.useRealTimers();
    }
    const premature = await request("/channel-auth/complete", "POST", browser, {
      id: challenge.id,
    });
    assert.equal(premature.status, 400);
    const sender = {
      channel: "telegram" as const,
      installationId,
      senderId: randomUUID(),
    };
    await runtime.runPromise(
      Effect.gen(function* () {
        yield* linkedIdentity(sender);
        const accounts = yield* ChannelAccounts;
        yield* accounts.confirmChallenge({ token, sender });
      })
    );
    const confirmed = await request(
      `/channel-auth/status?id=${challenge.id}`,
      "GET",
      browser
    );
    assert.deepEqual(await confirmed.json(), { status: "confirmed" });
    const crossSite = await request(
      "/channel-auth/complete",
      "POST",
      browser,
      { id: challenge.id },
      "https://attacker.invalid"
    );
    assert.equal(crossSite.status, 403);
    const completed = await request("/channel-auth/complete", "POST", browser, {
      id: challenge.id,
    });
    assert.equal(completed.status, 200);
    assert.deepEqual(await completed.json(), { ok: true });
    const identity = await runtime.runPromise(
      Effect.gen(function* () {
        const accounts = yield* ChannelAccounts;
        return yield* accounts.getActiveIdentity(sender);
      })
    );
    userIds.add(identity.userId);
    const sessionCookie = cookieHeader(completed);
    const sessionResponse = await request("/get-session", "GET", sessionCookie);
    assert.equal(sessionResponse.status, 200);
    const authenticated = Schema.decodeUnknownSync(
      Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })
    )(await sessionResponse.json());
    assert.equal(authenticated.user.id, identity.userId);
    const replay = await request("/channel-auth/complete", "POST", browser, {
      id: challenge.id,
    });
    assert.equal(replay.status, 400);
    const linking = await request(
      "/channel-auth/start",
      "POST",
      sessionCookie,
      { channel: "telegram", purpose: "link" }
    );
    assert.equal(linking.status, 200);
    const linkChallenge = Schema.decodeUnknownSync(channelChallengeSchema)(
      await linking.json()
    );
    const linkToken = new URL(linkChallenge.deepLink).searchParams.get("start");
    assert.ok(linkToken);
    await runtime.runPromise(
      Effect.gen(function* () {
        const accounts = yield* ChannelAccounts;
        yield* accounts.confirmChallenge({
          token: linkToken,
          sender: { ...sender, senderId: randomUUID() },
        });
      })
    );
    const linkBrowser = cookieHeader(linking);
    const missingLinkSession = await request(
      "/channel-auth/complete",
      "POST",
      linkBrowser,
      { id: linkChallenge.id }
    );
    assert.equal(missingLinkSession.status, 401);
    const linked = await request(
      "/channel-auth/complete",
      "POST",
      `${sessionCookie}; ${linkBrowser}`,
      { id: linkChallenge.id }
    );
    assert.equal(linked.status, 200);
    assert.equal(
      linked.headers
        .getSetCookie()
        .some((cookie) => cookie.includes("session_token=")),
      false
    );
    const sessionCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.session WHERE "userId" = $1',
      [identity.userId]
    );
    assert.equal(sessionCount.rows[0]?.count, 1);
    configuration = ConfigProvider.fromUnknown({
      KAPSO_PHONE_NUMBER_ID: installationId,
      KAPSO_PHONE_NUMBER: "+5511999999999",
    });
    const kapsoStarted = await request("/channel-auth/start", "POST", "", {
      channel: "kapso",
      purpose: "login",
    });
    assert.equal(kapsoStarted.status, 200);
    const entry = Schema.decodeUnknownSync(channelChallengeSchema)(
      await kapsoStarted.json()
    );
    const whatsapp = new URL(entry.deepLink);
    assert.equal(whatsapp.origin, "https://wa.me");
    assert.equal(whatsapp.pathname, "/5511999999999");
    assert.match(
      whatsapp.searchParams.get("text") ?? "",
      /^\/start [A-Za-z0-9_-]{43}$/u
    );
    assert.equal(kapsoStarted.headers.getSetCookie().length, 1);
    const waBrowser = cookieHeader(kapsoStarted);
    assert.equal(
      (await request(`/channel-auth/status?id=${entry.id}`, "GET")).status,
      400
    );
    const waiting = await request(
      `/channel-auth/status?id=${entry.id}`,
      "GET",
      waBrowser
    );
    assert.deepEqual(await waiting.json(), { status: "pending" });
  } finally {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`;
        yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`;
        for (const id of userIds) {
          yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${id}`).workspaceId}`;
          yield* sql`DELETE FROM public."user" WHERE id = ${id}`;
        }
      })
    );
    await runtime.dispose();
    await pool.end();
  }
});
