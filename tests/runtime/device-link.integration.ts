import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { betterAuth } from "better-auth";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import {
  Config,
  ConfigProvider,
  Effect,
  Layer,
  ManagedRuntime,
  Schema,
} from "effect";
import { Pool } from "pg";
import { test } from "vitest";
import { NativeDeviceAuth } from "../../server/accounts/device";
import { ChannelAccounts } from "../../server/accounts";
import { channelAuthPlugin } from "../../server/channel-auth";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import {
  channelConversationEntrySchema,
  deviceBoundSchema,
} from "../../shared/identity/channel-auth";
import { runtimeDatabase } from "./database";

const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
const BrowserSession = Schema.Struct({
  user: Schema.Struct({ id: Schema.String }),
  session: Schema.Struct({ id: Schema.String }),
});

test("native account linking pins purpose, both proofs and one browser session without merging accounts", async () => {
  const databaseUrl = await Effect.runPromise(
    Config.string("DATABASE_URL").pipe(Effect.provide(runtimeDatabase))
  );
  const pool = new Pool({ connectionString: databaseUrl });
  const installationId = randomUUID();
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
  const configuration = ConfigProvider.fromUnknown({
    KAPSO_PHONE_NUMBER_ID: installationId,
    KAPSO_PHONE_NUMBER: "+5511999999999",
  });
  const run = <A, E>(
    operation: Effect.Effect<
      A,
      E,
      NativeDeviceAuth | ChannelAccounts | PgClient.PgClient
    >
  ) =>
    runtime.runPromise(
      operation.pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, configuration)
      )
    );
  const baseURL = "http://localhost:3000";
  const auth = betterAuth({
    baseURL,
    secret,
    database: pool,
    trustedOrigins: [baseURL],
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    plugins: [channelAuthPlugin(run)],
  });
  const request = (path: string, cookie: string, body?: Schema.Json) => {
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, origin: baseURL, "content-type": "application/json" },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return auth.handler(
      new Request(`${baseURL}/api/auth/channel-auth/${path}`, init)
    );
  };
  const createIdentity = () =>
    run(
      Effect.gen(function* () {
        const accounts = yield* ChannelAccounts;
        const sql = yield* PgClient.PgClient;
        const identity = yield* accounts.resolveVerifiedSender({
          channel: "kapso",
          installationId,
          senderId: randomUUID(),
        });
        const scope = accessScopeForUser(`better-auth:${identity.userId}`);
        const sessionId = randomUUID();
        yield* sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${sessionId}, ${scope.workspaceId}, ${scope.userId})`;
        return {
          identity,
          scope,
          source: { identityId: identity.id, sessionId },
        };
      })
    );
  const owner = await createIdentity();
  const other = await createIdentity();
  const issue = (
    purpose: "login" | "link",
    callId = randomUUID(),
    source = owner.source
  ) =>
    run(
      Effect.gen(function* () {
        const devices = yield* NativeDeviceAuth;
        return yield* devices.issue({ ...source, callId, purpose });
      })
    );
  const pending = () =>
    run(
      Effect.gen(function* () {
        const devices = yield* NativeDeviceAuth;
        return yield* devices.pending(owner.source);
      })
    );
  const confirm = (
    id: string,
    boundAt: string,
    purpose: "login" | "link" = "link",
    source = owner.source
  ) =>
    run(
      Effect.gen(function* () {
        const devices = yield* NativeDeviceAuth;
        return yield* devices.confirm({
          ...source,
          challengeId: id,
          browserBoundAt: boundAt,
          purpose,
        });
      })
    );
  const signIn = async (source = owner.source) => {
    const issued = await issue("login", randomUUID(), source);
    assert.ok(issued.entryToken);
    const response = await request("device-bind", "", {
      id: issued.challenge.id,
      token: issued.entryToken,
      purpose: "login",
    });
    assert.equal(response.status, 200);
    const bound = await run(
      Effect.gen(function* () {
        const devices = yield* NativeDeviceAuth;
        return (yield* devices.pending(source)).find(
          (item) => item.id === issued.challenge.id
        );
      })
    );
    assert.ok(bound?.browserBoundAt);
    await confirm(bound.id, bound.browserBoundAt, "login", source);
    const completed = await request("complete", cookieHeader(response), {
      id: bound.id,
    });
    assert.equal(completed.status, 200);
    const cookie = cookieHeader(completed);
    const sessionResponse = await auth.handler(
      new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } })
    );
    return {
      cookie,
      ...Schema.decodeUnknownSync(BrowserSession)(await sessionResponse.json()),
    };
  };
  try {
    const browser = await signIn();
    const wrongBrowser = await signIn();
    const foreignBrowser = await signIn(other.source);
    const start = await request("start", browser.cookie, {
      channel: "kapso",
      purpose: "link",
    });
    assert.equal(start.status, 200);
    const entry = Schema.decodeUnknownSync(channelConversationEntrySchema)(
      await start.json()
    );
    assert.equal(
      new URL(entry.conversationUrl).searchParams.get("text"),
      "quero vincular meu WhatsApp à conta aberta no navegador"
    );
    assert.equal(start.headers.getSetCookie().length, 0);
    const callId = randomUUID();
    const issued = await issue("link", callId);
    assert.ok(issued.entryToken);
    assert.deepEqual(await issue("link", callId), issued);
    await assert.rejects(issue("login", callId));
    const input = {
      id: issued.challenge.id,
      token: issued.entryToken,
      purpose: "link",
    };
    assert.equal(
      (
        await request("device-bind", browser.cookie, {
          ...input,
          purpose: "login",
        })
      ).status,
      400
    );
    assert.equal((await request("device-bind", "", input)).status, 401);
    assert.equal(
      (await request("device-bind", foreignBrowser.cookie, input)).status,
      409
    );
    const bind = await request("device-bind", browser.cookie, input);
    assert.equal(bind.status, 200);
    const metadata = Schema.decodeUnknownSync(deviceBoundSchema)(
      await bind.json()
    );
    assert.equal(metadata.purpose, "link");
    assert.deepEqual(Object.keys(metadata).toSorted(), [
      "channel",
      "expiresAt",
      "id",
      "purpose",
    ]);
    const bindingCookie = cookieHeader(bind);
    const boundCookie = `${browser.cookie}; ${bindingCookie}`;
    assert.equal(
      (
        await request(
          "device-bind",
          `${wrongBrowser.cookie}; ${bindingCookie}`,
          input
        )
      ).status,
      401
    );
    assert.equal(
      (await request(`device?id=${input.id}&purpose=link`, bindingCookie))
        .status,
      401
    );
    assert.equal(
      (
        await request(
          `device?id=${input.id}&purpose=link`,
          `${wrongBrowser.cookie}; ${bindingCookie}`
        )
      ).status,
      401
    );
    assert.equal(
      (await request(`device?id=${input.id}&purpose=login`, boundCookie))
        .status,
      400
    );
    assert.equal(
      (await request(`device?id=${input.id}&purpose=link`, boundCookie)).status,
      200
    );
    const bound = (await pending()).find((item) => item.id === input.id);
    assert.ok(bound?.browserBoundAt);
    assert.equal(bound.purpose, "link");
    await assert.rejects(confirm(bound.id, bound.browserBoundAt, "login"));
    assert.equal(
      (await request("complete", boundCookie, { id: bound.id })).status,
      400
    );
    await confirm(bound.id, bound.browserBoundAt);
    assert.equal(
      (
        await request("complete", `${wrongBrowser.cookie}; ${bindingCookie}`, {
          id: bound.id,
        })
      ).status,
      401
    );
    const sessionsBefore = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.session WHERE "userId" = $1',
      [owner.identity.userId]
    );
    const results = await Promise.all([
      request("complete", boundCookie, { id: bound.id }),
      request("complete", boundCookie, { id: bound.id }),
    ]);
    assert.deepEqual(
      results.map((result) => result.status).toSorted((a, b) => a - b),
      [200, 400]
    );
    assert.ok(
      results.every(
        (response) =>
          !response.headers
            .getSetCookie()
            .some((cookie) => cookie.includes("session_token="))
      )
    );
    const sessionsAfter = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.session WHERE "userId" = $1',
      [owner.identity.userId]
    );
    assert.equal(sessionsAfter.rows[0]?.count, sessionsBefore.rows[0]?.count);
    const owners = await pool.query<{ id: string; userId: string }>(
      'SELECT id, user_id AS "userId" FROM channel_identity WHERE installation_id = $1 ORDER BY id',
      [installationId]
    );
    assert.deepEqual(
      owners.rows,
      [owner.identity, other.identity]
        .map(({ id, userId }) => ({ id, userId }))
        .toSorted((a, b) => a.id.localeCompare(b.id))
    );

    const stale = await issue("link");
    assert.ok(stale.entryToken);
    await pool.query(
      "UPDATE public.session SET \"createdAt\" = clock_timestamp() - interval '11 minutes' WHERE id = $1",
      [wrongBrowser.session.id]
    );
    assert.equal(
      (
        await request("device-bind", wrongBrowser.cookie, {
          id: stale.challenge.id,
          token: stale.entryToken,
          purpose: "link",
        })
      ).status,
      401
    );
    const expiring = await request("device-bind", browser.cookie, {
      id: stale.challenge.id,
      token: stale.entryToken,
      purpose: "link",
    });
    assert.equal(expiring.status, 200);
    const staleBound = (await pending()).find(
      (item) => item.id === stale.challenge.id
    );
    assert.ok(staleBound?.browserBoundAt);
    await pool.query(
      "UPDATE public.session SET \"expiresAt\" = clock_timestamp() - interval '1 second' WHERE id = $1",
      [browser.session.id]
    );
    await assert.rejects(confirm(staleBound.id, staleBound.browserBoundAt));
    assert.equal(
      (
        await request(
          "complete",
          `${browser.cookie}; ${cookieHeader(expiring)}`,
          { id: staleBound.id }
        )
      ).status,
      400
    );

    const renewed = await signIn();
    const revoked = await issue("link");
    assert.ok(revoked.entryToken);
    const revokedBinding = await request("device-bind", renewed.cookie, {
      id: revoked.challenge.id,
      token: revoked.entryToken,
      purpose: "link",
    });
    assert.equal(revokedBinding.status, 200);
    const revokedBound = (await pending()).find(
      (item) => item.id === revoked.challenge.id
    );
    assert.ok(revokedBound?.browserBoundAt);
    await confirm(revokedBound.id, revokedBound.browserBoundAt);
    await pool.query("DELETE FROM public.session WHERE id = $1", [
      renewed.session.id,
    ]);
    assert.equal(
      (
        await request(
          "complete",
          `${renewed.cookie}; ${cookieHeader(revokedBinding)}`,
          { id: revokedBound.id }
        )
      ).status,
      400
    );

    const expired = await issue("link");
    assert.ok(expired.entryToken);
    await pool.query(
      "UPDATE channel_auth_challenge SET created_at = clock_timestamp() - interval '10 minutes', expires_at = clock_timestamp() - interval '5 minutes' WHERE id = $1",
      [expired.challenge.id]
    );
    const fresh = await signIn();
    assert.equal(
      (
        await request("device-bind", fresh.cookie, {
          id: expired.challenge.id,
          token: expired.entryToken,
          purpose: "link",
        })
      ).status,
      400
    );
  } finally {
    await pool.query(
      "DELETE FROM channel_auth_challenge WHERE installation_id = $1",
      [installationId]
    );
    await pool.query(
      "DELETE FROM channel_identity WHERE installation_id = $1",
      [installationId]
    );
    await pool.query("DELETE FROM workspaces WHERE id = ANY($1)", [
      [owner.scope.workspaceId, other.scope.workspaceId],
    ]);
    await pool.query('DELETE FROM public."user" WHERE id = ANY($1)', [
      [owner.identity.userId, other.identity.userId],
    ]);
    await runtime.dispose();
    await pool.end();
  }
});
