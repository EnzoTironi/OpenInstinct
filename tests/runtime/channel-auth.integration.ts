import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { betterAuth } from "better-auth";
import {
  Config,
  ConfigProvider,
  Schema,
  Effect,
  Layer,
  ManagedRuntime,
} from "effect";
import { Pool } from "pg";
import { test } from "vitest";

import { NativeDeviceAuth } from "../../server/accounts/device";
import { ChannelAccounts } from "../../server/accounts/index.ts";
import { channelAuthPlugin } from "../../server/channel-auth/index.ts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import {
  channelChallengeSchema,
  channelConversationEntrySchema,
  type channelChallengeIdSchema,
  type channelChallengeRequestSchema,
} from "../../shared/identity/channel-auth.ts";
import { runtimeDatabase } from "./database";

const decodeChannelChallengeSchema = Schema.decodeUnknownSync(
  channelChallengeSchema
);

const decodeSchema_Struct_user_Schema_Struct_id_Schema_String =
  Schema.decodeUnknownSync(
    Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })
  );

const decodeChannelConversationEntrySchema = Schema.decodeUnknownSync(
  channelConversationEntrySchema
);

const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

interface ChallengeSender {
  readonly channel: "telegram";
  readonly installationId: string;
  readonly senderId: string;
}

const confirmChannelChallenge = Effect.fn("confirmChannelChallenge")(function* (
  token: string,
  sender: ChallengeSender
) {
  const accounts = yield* ChannelAccounts;
  yield* accounts.confirmChallenge({ token, sender });
});

const readActiveChannelIdentity = Effect.fn("readActiveChannelIdentity")(
  function* (sender: ChallengeSender) {
    const accounts = yield* ChannelAccounts;

    return yield* accounts.getActiveIdentity(sender);
  }
);

const hasSessionTokenCookie = (cookies: readonly string[]) =>
  cookies.some((cookie) => cookie.includes("session_token="));

const deleteChannelAuthUser = Effect.fn("deleteChannelAuthUser")(function* (
  sql: PgClient.PgClient,
  id: string
) {
  yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${id}`).workspaceId}`;
  yield* sql`DELETE FROM public."user" WHERE id = ${id}`;
});

const cleanupChannelAuthInstallation = Effect.fn(
  "cleanupChannelAuthInstallation"
)(function* (installationId: string, userIds: ReadonlySet<string>) {
  const sql = yield* PgClient.PgClient;
  yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`;
  yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`;

  yield* Effect.forEach([...userIds], (id) => deleteChannelAuthUser(sql, id), {
    concurrency: 1,
  });
});

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

  const request = (options: {
    path: string;
    method: string;
    cookie?: string;
    body?:
      | typeof channelChallengeIdSchema.Type
      | typeof channelChallengeRequestSchema.Type;
    origin?: string;
  }) => {
    const { path, method, cookie = "", body, origin = baseURL } = options;

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
    const unavailable = await request({
      path: "/channel-auth/start",
      method: "POST",
      cookie: "",
      body: {
        channel: "kapso",
        purpose: "login",
      },
    });

    assert.equal(unavailable.status, 503);

    const forbidden = await request({
      path: "/channel-auth/start",
      method: "POST",
      cookie: "",
      body: { channel: "telegram", purpose: "login" },
      origin: "https://attacker.invalid",
    });

    assert.equal(forbidden.status, 403);

    const noSession = await request({
      path: "/channel-auth/start",
      method: "POST",
      cookie: "",
      body: {
        channel: "telegram",
        purpose: "link",
      },
    });

    assert.equal(noSession.status, 401);

    const started = await request({
      path: "/channel-auth/start",
      method: "POST",
      cookie: "",
      body: {
        channel: "telegram",
        purpose: "login",
      },
    });

    assert.equal(started.status, 200);

    const challenge = decodeChannelChallengeSchema(await started.json());

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

    const noBrowser = await request({
      path: `/channel-auth/status?id=${challenge.id}`,
      method: "GET",
    });

    assert.equal(noBrowser.status, 400);

    const tampered = await request({
      path: `/channel-auth/status?id=${challenge.id}`,
      method: "GET",
      cookie: `${browser}x`,
    });

    assert.equal(tampered.status, 400);

    const pending = await request({
      path: `/channel-auth/status?id=${challenge.id}`,
      method: "GET",
      cookie: browser,
    });

    assert.deepEqual(await pending.json(), { status: "pending" });
    assert.equal(pending.headers.get("cache-control"), "no-store");

    const premature = await request({
      path: "/channel-auth/complete",
      method: "POST",
      cookie: browser,
      body: {
        id: challenge.id,
      },
    });

    assert.equal(premature.status, 400);

    const sender = {
      channel: "telegram" as const,
      installationId,
      senderId: randomUUID(),
    };

    await runtime.runPromise(confirmChannelChallenge(token, sender));

    const confirmed = await request({
      path: `/channel-auth/status?id=${challenge.id}`,
      method: "GET",
      cookie: browser,
    });

    assert.deepEqual(await confirmed.json(), { status: "confirmed" });

    const crossSite = await request({
      path: "/channel-auth/complete",
      method: "POST",
      cookie: browser,
      body: { id: challenge.id },
      origin: "https://attacker.invalid",
    });

    assert.equal(crossSite.status, 403);

    const completed = await request({
      path: "/channel-auth/complete",
      method: "POST",
      cookie: browser,
      body: {
        id: challenge.id,
      },
    });

    assert.equal(completed.status, 200);
    assert.deepEqual(await completed.json(), { ok: true });

    const identity = await runtime.runPromise(
      readActiveChannelIdentity(sender)
    );

    userIds.add(identity.userId);
    const sessionCookie = cookieHeader(completed);

    const sessionResponse = await request({
      path: "/get-session",
      method: "GET",
      cookie: sessionCookie,
    });

    assert.equal(sessionResponse.status, 200);

    const authenticated =
      decodeSchema_Struct_user_Schema_Struct_id_Schema_String(
        await sessionResponse.json()
      );

    assert.equal(authenticated.user.id, identity.userId);

    const replay = await request({
      path: "/channel-auth/complete",
      method: "POST",
      cookie: browser,
      body: {
        id: challenge.id,
      },
    });

    assert.equal(replay.status, 400);

    const linking = await request({
      path: "/channel-auth/start",
      method: "POST",
      cookie: sessionCookie,
      body: { channel: "telegram", purpose: "link" },
    });

    assert.equal(linking.status, 200);

    const linkChallenge = decodeChannelChallengeSchema(await linking.json());

    const linkToken = new URL(linkChallenge.deepLink).searchParams.get("start");
    assert.ok(linkToken);
    await runtime.runPromise(
      confirmChannelChallenge(linkToken, {
        ...sender,
        senderId: randomUUID(),
      })
    );
    const linkBrowser = cookieHeader(linking);

    const missingLinkSession = await request({
      path: "/channel-auth/complete",
      method: "POST",
      cookie: linkBrowser,
      body: { id: linkChallenge.id },
    });

    assert.equal(missingLinkSession.status, 401);

    const linked = await request({
      path: "/channel-auth/complete",
      method: "POST",
      cookie: `${sessionCookie}; ${linkBrowser}`,
      body: { id: linkChallenge.id },
    });

    assert.equal(linked.status, 200);
    assert.equal(hasSessionTokenCookie(linked.headers.getSetCookie()), false);

    const sessionCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.session WHERE "userId" = $1',
      [identity.userId]
    );

    assert.equal(sessionCount.rows[0]?.count, 1);
    configuration = ConfigProvider.fromUnknown({
      KAPSO_PHONE_NUMBER_ID: installationId,
      KAPSO_PHONE_NUMBER: "+5511999999999",
    });

    const kapsoStarted = await request({
      path: "/channel-auth/start",
      method: "POST",
      cookie: "",
      body: {
        channel: "kapso",
        purpose: "login",
      },
    });

    assert.equal(kapsoStarted.status, 200);

    const entry = decodeChannelConversationEntrySchema(
      await kapsoStarted.json()
    );

    const whatsapp = new URL(entry.conversationUrl);
    assert.equal(whatsapp.origin, "https://wa.me");
    assert.equal(whatsapp.pathname, "/5511999999999");
    assert.equal(
      whatsapp.searchParams.get("text"),
      "quero abrir minha conta no navegador"
    );
    assert.equal(kapsoStarted.headers.getSetCookie().length, 0);
  } finally {
    await runtime.runPromise(
      cleanupChannelAuthInstallation(installationId, userIds)
    );
    await runtime.dispose();
    await pool.end();
  }
});
