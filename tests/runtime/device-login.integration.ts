import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { betterAuth } from "better-auth";
import { Config, Effect, Layer, ManagedRuntime, Schema } from "effect";
import type { ToolContext } from "eve/tools";
import { Pool } from "pg";
import { test } from "vitest";

import { deviceAuthStatus } from "../../agent/tools/device-auth";
import { ChannelAccounts } from "../../server/accounts";
import { NativeDeviceAuth } from "../../server/accounts/device";
import { channelAuthPlugin } from "../../server/channel-auth";
import { channelPrincipal } from "../../server/channels/principal";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const decodeSchema_Struct_user_Schema_Struct_id_Schema_String =
  Schema.decodeUnknownSync(
    Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })
  );

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

type DeviceRuntimeServices =
  | NativeDeviceAuth
  | ChannelAccounts
  | PgClient.PgClient;

type DeviceRun = <A, E>(
  program: Effect.Effect<A, E, DeviceRuntimeServices>
) => Promise<A>;

function makeDeviceRuntime(secret: string) {
  return ManagedRuntime.make(
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
}

const resolveVerifiedSender = Effect.fn("resolveVerifiedSender")(function* (
  installationId: string,
  senderId: string
) {
  const accounts = yield* ChannelAccounts;

  return yield* accounts.resolveVerifiedSender({
    channel: "kapso",
    installationId,
    senderId,
  });
});

const insertOwnerSessions = Effect.fn("insertOwnerSessions")(function* (
  sessionIds: readonly string[],
  workspaceId: string,
  userId: string
) {
  const sql = yield* PgClient.PgClient;

  yield* Effect.forEach(
    sessionIds,
    (id) =>
      sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${id}, ${workspaceId}, ${userId})`,
    { concurrency: 1 }
  );
});

const insertForeignSession = Effect.fn("insertForeignSession")(function* (
  sessionId: string,
  workspaceId: string,
  userId: string
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${sessionId}, ${workspaceId}, ${userId})`;
});

function unsupportedToolContextMethod(): never {
  throw new Error("This test has no sandbox.");
}

function buildToolContext(
  sessionId: string,
  principal: ReturnType<typeof channelPrincipal>
): ToolContext {
  return {
    session: {
      id: sessionId,
      auth: { current: principal, initiator: principal },
      turn: { id: randomUUID(), sequence: 1 },
    },
    callId: randomUUID(),
    toolName: "device-auth-status",
    abortSignal: new AbortController().signal,
    getSandbox: unsupportedToolContextMethod,
    getSkill: unsupportedToolContextMethod,
    getToken: unsupportedToolContextMethod,
    requireAuth: unsupportedToolContextMethod,
  };
}

function issueLogin(
  run: DeviceRun,
  source: { identityId: string; sessionId: string },
  callId: string
) {
  return run(
    Effect.gen(function* () {
      const devices = yield* NativeDeviceAuth;

      return yield* devices.issue({ ...source, callId, purpose: "login" });
    })
  );
}

function pendingFor(run: DeviceRun, identityId: string, sessionId: string) {
  return run(
    Effect.gen(function* () {
      const devices = yield* NativeDeviceAuth;

      return yield* devices.pending({ identityId, sessionId });
    })
  );
}

function confirmLogin(input: {
  readonly run: DeviceRun;
  readonly identityId: string;
  readonly sessionId: string;
  readonly challengeId: string;
  readonly browserBoundAt: string;
}) {
  return input.run(
    Effect.gen(function* () {
      const devices = yield* NativeDeviceAuth;

      return yield* devices.confirm({
        purpose: "login",
        identityId: input.identityId,
        sessionId: input.sessionId,
        challengeId: input.challengeId,
        browserBoundAt: input.browserBoundAt,
      });
    })
  );
}

function confirmChallengeToken(
  run: DeviceRun,
  entryToken: string,
  identity: { channel: "kapso" | "telegram"; senderId: string },
  installationId: string
) {
  return run(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;

      return yield* accounts.confirmChallenge({
        token: entryToken,
        sender: {
          channel: identity.channel,
          installationId,
          senderId: identity.senderId,
        },
      });
    })
  );
}

function authRequest(input: {
  readonly auth: { handler: (request: Request) => Promise<Response> };
  readonly baseURL: string;
  readonly path: string;
  readonly body?: {
    readonly id: string;
    readonly token?: string;
    readonly purpose?: "login" | "link";
  };
  readonly cookie?: string;
  readonly origin?: string;
}) {
  const cookie = input.cookie ?? "";
  const origin = input.origin ?? input.baseURL;
  const init: RequestInit = {
    method: input.body === undefined ? "GET" : "POST",
    headers: { origin, cookie, "content-type": "application/json" },
  };

  if (input.body) init.body = JSON.stringify(input.body);

  return input.auth.handler(
    new Request(`${input.baseURL}/api/auth${input.path}`, init)
  );
}

function revokeIdentity(run: DeviceRun, identityId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`UPDATE public.channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
    })
  );
}

function cleanupDeviceLogin(input: {
  readonly run: DeviceRun;
  readonly installationId: string;
  readonly scope: { workspaceId: string; userId: string };
  readonly otherScope: { workspaceId: string; userId: string };
  readonly identityUserId: string;
  readonly otherUserId: string;
}) {
  return input.run(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${input.installationId}`;
      yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${input.installationId}`;
      yield* sql`DELETE FROM workspaces WHERE id = ${input.scope.workspaceId}`;
      yield* sql`DELETE FROM public."user" WHERE id = ${input.identityUserId}`;
      yield* sql`DELETE FROM workspaces WHERE id = ${input.otherScope.workspaceId}`;
      yield* sql`DELETE FROM public."user" WHERE id = ${input.otherUserId}`;
    })
  );
}

async function rejectStatusWithAuthenticator(
  context: ToolContext,
  principal: ReturnType<typeof channelPrincipal>,
  authenticator: string
) {
  await assert.rejects(async () =>
    deviceAuthStatus.execute(
      {},
      {
        ...context,
        session: {
          ...context.session,
          auth: {
            current: { ...principal, authenticator },
            initiator: principal,
          },
        },
      }
    )
  );
}

async function rejectNullCurrentAuth(
  context: ToolContext,
  principal: ReturnType<typeof channelPrincipal>
) {
  await assert.rejects(async () =>
    deviceAuthStatus.execute(
      {},
      {
        ...context,
        session: {
          ...context.session,
          auth: { current: null, initiator: principal },
        },
      }
    )
  );
}

async function rejectParentSession(context: ToolContext, sessionId: string) {
  await assert.rejects(async () =>
    deviceAuthStatus.execute(
      {},
      {
        ...context,
        session: {
          ...context.session,
          parent: {
            callId: randomUUID(),
            rootSessionId: sessionId,
            sessionId,
            turn: context.session.turn,
          },
        },
      }
    )
  );
}

function asDeviceRun(runtime: ReturnType<typeof makeDeviceRuntime>): DeviceRun {
  return (program) => runtime.runPromise(program);
}

test("native browser binding requires same-session approval before BetterAuth can issue a session", async () => {
  const url = await Effect.runPromise(
    Config.string("DATABASE_URL").pipe(Effect.provide(runtimeDatabase))
  );

  const secret = randomBytes(32).toString("base64url");
  const runtime = makeDeviceRuntime(secret);
  const run = asDeviceRun(runtime);
  const pool = new Pool({ connectionString: url });
  const baseURL = "http://localhost:3000";

  const auth = betterAuth({
    baseURL,
    database: pool,
    secret,
    trustedOrigins: [baseURL],
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    plugins: [channelAuthPlugin(run)],
  });

  const installationId = randomUUID();

  const identity = await run(
    resolveVerifiedSender(installationId, randomUUID())
  );

  const otherIdentity = await run(
    resolveVerifiedSender(installationId, randomUUID())
  );

  const otherScope = accessScopeForUser(`better-auth:${otherIdentity.userId}`);
  const foreignSession = randomUUID();
  const scope = accessScopeForUser(`better-auth:${identity.userId}`);
  const source = { identityId: identity.id, sessionId: randomUUID() };
  const otherSession = randomUUID();

  try {
    await run(
      insertOwnerSessions(
        [source.sessionId, otherSession],
        scope.workspaceId,
        scope.userId
      )
    );
    await run(
      insertForeignSession(
        foreignSession,
        otherScope.workspaceId,
        otherScope.userId
      )
    );
    const principal = channelPrincipal(identity);
    const context = buildToolContext(source.sessionId, principal);

    assert.deepEqual(await deviceAuthStatus.execute({}, context), {
      requests: [],
    });
    await rejectNullCurrentAuth(context, principal);
    await rejectStatusWithAuthenticator(context, principal, "scheduled-worker");
    await rejectStatusWithAuthenticator(context, principal, "scheduled-result");
    await rejectStatusWithAuthenticator(context, principal, "better-auth");
    await rejectParentSession(context, source.sessionId);

    const issued = await issueLogin(run, source, "first");
    assert.deepEqual(await issueLogin(run, source, "first"), issued);
    const entryToken = issued.entryToken;
    assert.ok(entryToken);
    assert.deepEqual(await pendingFor(run, identity.id, source.sessionId), []);
    await assert.rejects(
      confirmLogin({
        run,
        identityId: identity.id,
        sessionId: source.sessionId,
        challengeId: issued.challenge.id,
        browserBoundAt: new Date().toISOString(),
      })
    );
    await assert.rejects(
      confirmChallengeToken(run, entryToken, identity, installationId)
    );

    const body = {
      id: issued.challenge.id,
      token: entryToken,
      purpose: "login" as const,
    };

    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/device-bind",
          body,
          cookie: "",
          origin: "https://attacker.invalid",
        })
      ).status,
      403
    );
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/device-bind",
          body: {
            ...body,
            token: randomBytes(32).toString("base64url"),
          },
        })
      ).status,
      400
    );

    const binding = await authRequest({
      auth,
      baseURL,
      path: "/channel-auth/device-bind",
      body,
    });

    assert.equal(binding.status, 200);
    assert.equal(binding.headers.get("cache-control"), "no-store");
    const browser = cookies(binding);
    assert.match(browser, /channel_challenge/);
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/device-bind",
          body,
        })
      ).status,
      400
    );
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/device-bind",
          body,
          cookie: browser,
        })
      ).status,
      200
    );
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/complete",
          body: { id: body.id },
          cookie: browser,
        })
      ).status,
      400
    );
    assert.deepEqual(await pendingFor(run, identity.id, otherSession), []);
    const bound = (await pendingFor(run, identity.id, source.sessionId))[0];
    assert.ok(bound?.browserBoundAt);
    assert.equal((await issueLogin(run, source, "first")).entryToken, null);
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: `/channel-auth/device?id=${body.id}&purpose=login`,
        })
      ).status,
      400
    );

    const resumed = await authRequest({
      auth,
      baseURL,
      path: `/channel-auth/device?id=${body.id}&purpose=login`,
      body: undefined,
      cookie: browser,
    });

    assert.equal(resumed.status, 200);
    assert.equal(resumed.headers.get("cache-control"), "no-store");
    assert.deepEqual(await resumed.json(), {
      id: bound.id,
      purpose: "login",
      channel: bound.channel,
      expiresAt: bound.expiresAt,
    });
    assert.deepEqual(
      await pendingFor(run, otherIdentity.id, foreignSession),
      []
    );
    await assert.rejects(
      confirmLogin({
        run,
        identityId: otherIdentity.id,
        sessionId: foreignSession,
        challengeId: body.id,
        browserBoundAt: bound.browserBoundAt ?? "",
      })
    );

    await assert.rejects(
      confirmLogin({
        run,
        identityId: identity.id,
        sessionId: otherSession,
        challengeId: body.id,
        browserBoundAt: bound.browserBoundAt,
      })
    );
    await assert.rejects(
      confirmLogin({
        run,
        identityId: identity.id,
        sessionId: source.sessionId,
        challengeId: body.id,
        browserBoundAt: "2000-01-01T00:00:00.000Z",
      })
    );
    assert.deepEqual(
      await confirmLogin({
        run,
        identityId: identity.id,
        sessionId: source.sessionId,
        challengeId: body.id,
        browserBoundAt: bound.browserBoundAt,
      }),
      {
        confirmed: true,
      }
    );
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/complete",
          body: {
            id: body.id,
          },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: `/channel-auth/device?id=${body.id}&purpose=login`,
          body: undefined,
          cookie: browser,
        })
      ).status,
      200
    );

    const complete = await authRequest({
      auth,
      baseURL,
      path: "/channel-auth/complete",
      body: { id: body.id },
      cookie: browser,
    });

    assert.equal(complete.status, 200);

    const session = await authRequest({
      auth,
      baseURL,
      path: "/get-session",
      body: undefined,
      cookie: cookies(complete),
    });

    const sessionBody = decodeSchema_Struct_user_Schema_Struct_id_Schema_String(
      await session.json()
    );

    assert.equal(sessionBody.user.id, identity.userId);
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/complete",
          body: { id: body.id },
          cookie: browser,
        })
      ).status,
      400
    );
    await assert.rejects(
      confirmLogin({
        run,
        identityId: identity.id,
        sessionId: source.sessionId,
        challengeId: body.id,
        browserBoundAt: bound.browserBoundAt,
      })
    );
    const revoked = await issueLogin(run, source, "revoked");
    assert.ok(revoked.entryToken);

    const boundRevoked = await authRequest({
      auth,
      baseURL,
      path: "/channel-auth/device-bind",
      body: {
        id: revoked.challenge.id,
        purpose: "login",
        token: revoked.entryToken,
      },
    });

    assert.equal(boundRevoked.status, 200);

    const revocationTarget = (
      await pendingFor(run, identity.id, source.sessionId)
    )[0];

    assert.ok(revocationTarget?.browserBoundAt);
    await confirmLogin({
      run,
      identityId: identity.id,
      sessionId: source.sessionId,
      challengeId: revoked.challenge.id,
      browserBoundAt: revocationTarget.browserBoundAt,
    });
    await revokeIdentity(run, identity.id);
    await assert.rejects(pendingFor(run, identity.id, source.sessionId));
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: `/channel-auth/device?id=${revoked.challenge.id}&purpose=login`,
          body: undefined,
          cookie: cookies(boundRevoked),
        })
      ).status,
      400
    );
    assert.equal(
      (
        await authRequest({
          auth,
          baseURL,
          path: "/channel-auth/complete",
          body: { id: revoked.challenge.id },
          cookie: cookies(boundRevoked),
        })
      ).status,
      400
    );
  } finally {
    await cleanupDeviceLogin({
      run,
      installationId,
      scope,
      otherScope,
      identityUserId: identity.userId,
      otherUserId: otherIdentity.userId,
    });
    await runtime.dispose();
    await pool.end();
  }
});
