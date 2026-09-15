import { requirePersonalMemoryMembership } from "../../server/personal-memory/access";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Schema } from "effect";
import { test } from "vitest";
import type { MemoryTurnStartedContext, MemoryToolsContext } from "eve/memory";
import type { ToolContext } from "eve/tools";
import { getAuth } from "../../db/services/auth";
import { patchUserProfile } from "../../db/services/user-profile";
import { channelChallengeSchema } from "../../shared/identity/channel-auth";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { applicationOrigin } from "../../shared/environment/origin";
import { ChannelAccounts, type Identity } from "../../server/accounts";
import { PersonalMemory } from "../../server/personal-memory";
import { inspectPersonalMemory } from "../../server/personal-memory/export";
import { serverRuntime } from "../../server/runtime";
import { createMemoryDocumentBackend } from "../../agent/lib/memory-document-backend";
import { personalMemoryProvider } from "../../server/executor/memory/personal-memory-provider";
import { channelPrincipal } from "../../server/channels/principal";
import { inspectStoredPersonalMemory } from "../../server/executor/tools/personal-memory";
import { GET } from "../../app/api/account/personal-memory/export/route";
import { runtimeDatabase } from "./database";
import { linkedIdentity } from "./identity-fixture";

const memoryDocumentBackend = createMemoryDocumentBackend(Effect.void);

const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

async function fromProcess(cookie: string) {
  const child = spawn(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      fileURLToPath(new URL("./personal-memory-process.ts", import.meta.url)),
    ],
    {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  let output = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.stdin.end(cookie);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(code, 0, stderr);
  return Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        status: Schema.String,
        reason: Schema.optionalKey(Schema.String),
        snapshot: Schema.optionalKey(
          Schema.Struct({ profile: Schema.Unknown, notes: Schema.Unknown })
        ),
      })
    )
  )(output);
}

function memoryContext(
  identity: Identity
): MemoryTurnStartedContext & Pick<MemoryToolsContext, "channel"> {
  const principal = channelPrincipal(identity);
  const scope = accessScopeForUser(principal.principalId);
  const id = randomUUID();
  return {
    abortSignal: new AbortController().signal,
    channel: { kind: identity.channel },
    memory: {
      scope: {
        key: `personal-memory-test:${randomUUID()}`,
        namespace: "personal-memory-integration",
        value: scope.workspaceId,
      },
      slot: "profile",
    },
    messages: [],
    operationId: randomUUID(),
    session: {
      id,
      auth: { current: principal, initiator: principal },
      turn: { id, sequence: 1 },
    },
    turn: { id, input: [], sequence: 1 },
    getSandbox() {
      throw new Error("Personal memory must not request a sandbox.");
    },
    getSkill() {
      throw new Error("Personal memory must not request a skill.");
    },
  };
}

function toolContext(context: MemoryTurnStartedContext): ToolContext {
  return {
    ...context,
    callId: randomUUID(),
    toolName: "personal-memory-inspect",
    getToken() {
      throw new Error("Personal memory must not request a connection.");
    },
    requireAuth() {
      throw new Error(
        "Personal memory must not request provider authorization."
      );
    },
  };
}

test("actual account auth, profile store, Eve provider, private tool and export isolate owners across processes and reject revoked access", async () => {
  await Effect.runPromise(Effect.void.pipe(Effect.provide(runtimeDatabase)));
  const installationId = await Effect.runPromise(
    Config.string("TELEGRAM_BOT_ID")
  );
  const accounts = await serverRuntime.runPromise(ChannelAccounts);
  const auth = await getAuth();
  const origin = applicationOrigin();
  const users: Identity[] = [];
  const keys: string[] = [];
  const login = async (senderId: string = randomUUID()) => {
    const request = (
      path: string,
      body: { channel: "telegram"; purpose: "login" } | { id: string },
      cookie = ""
    ) =>
      auth.handler(
        new Request(`${origin}/api/auth/channel-auth/${path}`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", cookie },
          body: JSON.stringify(body),
        })
      );
    const started = await request("start", {
      channel: "telegram",
      purpose: "login",
    });
    assert.equal(started.status, 200);
    const challenge = Schema.decodeUnknownSync(channelChallengeSchema)(
      await started.json()
    );
    const token = new URL(challenge.deepLink).searchParams.get("start");
    assert.ok(token);
    const sender = {
      channel: "telegram" as const,
      installationId,
      senderId,
    };
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const resolution = yield* accounts.resolveVerifiedSender(sender);
        if (resolution.status === "unlinked") yield* linkedIdentity(sender);
        yield* accounts.confirmChallenge({ token, sender });
      })
    );
    const complete = await request(
      "complete",
      { id: challenge.id },
      cookies(started)
    );
    assert.equal(complete.status, 200);
    const identity = await serverRuntime.runPromise(
      accounts.getActiveIdentity(sender)
    );
    users.push(identity);
    return { identity, cookie: cookies(complete) };
  };
  try {
    const owner = await login();
    const other = await login();
    const ownerHeaders = new Headers({ cookie: owner.cookie });
    const otherHeaders = new Headers({ cookie: other.cookie });
    const ownerScope = accessScopeForUser(
      `better-auth:${owner.identity.userId}`
    );
    const otherScope = accessScopeForUser(
      `better-auth:${other.identity.userId}`
    );
    assert.equal(
      (await auth.api.getSession({ headers: ownerHeaders }))?.user.id,
      owner.identity.userId
    );
    assert.equal(
      (await serverRuntime.runPromise(inspectPersonalMemory(ownerHeaders)))
        .notes.status,
      "unresolved"
    );
    await serverRuntime.runPromise(
      patchUserProfile(requirePersonalMemoryMembership(ownerScope), {
        firstName: "Personal-memory owner",
        city: "Owner-only city",
      })
    );
    await serverRuntime.runPromise(
      patchUserProfile(requirePersonalMemoryMembership(otherScope), {
        firstName: "Second owner",
        city: "Foreign-only city",
      })
    );
    const ownerContext = memoryContext(owner.identity);
    const otherContext = memoryContext(other.identity);
    await Promise.all(
      [ownerContext, otherContext].map(async (context, index) => {
        keys.push(context.memory.scope.key);
        await memoryDocumentBackend.write({
          key: context.memory.scope.key,
          signal: context.abortSignal,
          content: `<!-- eve-memory-file-v1 lastAllocatedIndex=0 -->\n0: ${index === 0 ? "Owner-only note" : "Foreign-only note"}.\n`,
          expectedVersion: null,
        });
        const recall =
          await personalMemoryProvider.recall["turn.started"](context);
        assert.match(
          recall?.messages[0]?.content ?? "",
          index === 0 ? /Owner-only note/ : /Foreign-only note/
        );
      })
    );
    const memory = await serverRuntime.runPromise(PersonalMemory);
    await assert.rejects(
      serverRuntime.runPromise(
        memory.bind(otherScope, {
          ...ownerContext.memory,
          scope: {
            ...ownerContext.memory.scope,
            value: otherScope.workspaceId,
          },
        })
      ),
      { reason: "invalid_binding" }
    );
    const snapshot = await serverRuntime.runPromise(
      inspectPersonalMemory(ownerHeaders)
    );
    assert.equal(snapshot.profile.city, "Owner-only city");
    assert.equal(snapshot.notes.status, "located");
    assert.equal(snapshot.notes.documents.length, 1);
    assert.match(snapshot.notes.documents[0]?.content ?? "", /Owner-only note/);
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /Foreign-only|personal-memory-test:/
    );
    const response = await GET(
      new Request(
        `${origin}/api/account/personal-memory/export?key=${encodeURIComponent(otherContext.memory.scope.key)}&workspaceId=${otherScope.workspaceId}`,
        { headers: ownerHeaders }
      )
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /attachment/
    );
    const exported = Schema.decodeUnknownSync(
      Schema.Struct({
        scope: Schema.String,
        profile: Schema.Unknown,
        notes: Schema.Unknown,
      })
    )(await response.json());
    assert.equal(exported.scope, "stored-personal-memory");
    assert.deepEqual(exported.profile, snapshot.profile);
    assert.deepEqual(exported.notes, snapshot.notes);
    assert.doesNotMatch(
      JSON.stringify(exported),
      /Foreign-only|personal-memory-test:/
    );
    const native = await inspectStoredPersonalMemory.execute(
      {},
      toolContext(ownerContext)
    );
    assert.ok(
      "profile" in native && "notes" in native && "downloadUrl" in native
    );
    assert.equal(native.profile.city, "Owner-only city");
    assert.deepEqual(native.notes, snapshot.notes);
    assert.match(
      native.downloadUrl,
      /\/api\/account\/personal-memory\/export$/
    );
    const fresh = await fromProcess(owner.cookie);
    assert.equal(fresh.status, "Success");
    assert.deepEqual(fresh.snapshot?.notes, snapshot.notes);
    assert.deepEqual(fresh.snapshot.profile, snapshot.profile);
    assert.equal(
      (await GET(new Request(`${origin}/api/account/personal-memory/export`)))
        .status,
      401
    );
    const createNativeTools = personalMemoryProvider.tools;
    assert.ok(createNativeTools);
    const nativeTools = await createNativeTools(ownerContext);
    const save = nativeTools?.save_memory;
    const remove = nativeTools?.remove_memory;
    assert.ok(save && remove);
    await assert.rejects(async () =>
      save.execute(
        // @ts-expect-error The native heterogeneous tool map erases its input type.
        { text: "Another account cannot use this bound tool" },
        toolContext(otherContext)
      )
    );
    const browserSession = await auth.api.getSession({ headers: ownerHeaders });
    assert.ok(browserSession);
    const webPrincipal = {
      principalId: ownerScope.userId,
      principalType: "user" as const,
      authenticator: "authjs",
      attributes: {
        conversationChannel: "eve",
        workspaceId: ownerScope.workspaceId,
        authSessionId: browserSession.session.id,
      },
    };
    const webContext = {
      ...ownerContext,
      session: {
        ...ownerContext.session,
        auth: { current: webPrincipal, initiator: webPrincipal },
      },
    };
    assert.match(
      (await personalMemoryProvider.recall["turn.started"](webContext))
        ?.messages[0]?.content ?? "",
      /Owner-only note/
    );
    const missingWebSession = {
      ...webContext,
      session: {
        ...webContext.session,
        auth: {
          ...webContext.session.auth,
          current: {
            ...webPrincipal,
            attributes: {
              conversationChannel: "eve",
              workspaceId: ownerScope.workspaceId,
            },
          },
        },
      },
    };
    await assert.rejects(
      personalMemoryProvider.recall["turn.started"](missingWebSession)
    );
    const webTools = await createNativeTools(webContext);
    assert.ok(webTools?.save_memory);
    const secondLogin = await login(owner.identity.senderId);
    const secondSession = await auth.api.getSession({
      headers: new Headers({ cookie: secondLogin.cookie }),
    });
    assert.ok(secondSession);
    // A different active session for the same account must not authorize this captured web principal.
    const revokedWeb = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          origin,
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      })
    );
    assert.equal(revokedWeb.status, 200);
    assert.equal(
      (
        await auth.api.getSession({
          headers: new Headers({ cookie: secondLogin.cookie }),
        })
      )?.user.id,
      owner.identity.userId
    );
    await assert.rejects(
      personalMemoryProvider.recall["turn.started"](webContext)
    );
    await assert.rejects(async () =>
      webTools.save_memory?.execute(
        // @ts-expect-error Synthetic input exercises the real native save_memory tool.
        { text: "Must not use another active browser session" },
        toolContext(webContext)
      )
    );
    const browserSecret = randomBytes(32).toString("base64url");
    const link = await serverRuntime.runPromise(
      accounts.issueChallenge({
        purpose: "link" as const,
        userId: owner.identity.userId,
        sessionId: secondSession.session.id,
        channel: "telegram",
        installationId,
        browserSecret,
      })
    );
    const linkedSender = {
      channel: "telegram" as const,
      installationId,
      senderId: randomUUID(),
    };
    await serverRuntime.runPromise(
      accounts.confirmChallenge({ token: link.token, sender: linkedSender })
    );
    await serverRuntime.runPromise(
      accounts.consumeChallenge({
        challengeId: link.challengeId,
        browserSecret,
        currentSessionId: secondSession.session.id,
      })
    );
    users.push(
      await serverRuntime.runPromise(accounts.getActiveIdentity(linkedSender))
    );
    const beforeRevocation = await memoryDocumentBackend.read({
      key: ownerContext.memory.scope.key,
      signal: ownerContext.abortSignal,
    });
    await serverRuntime.runPromise(
      accounts.revokeIdentity({
        identityId: owner.identity.id,
        userId: owner.identity.userId,
      })
    );
    // Revoking one channel preserves the account membership and the other linked channel.
    assert.equal(
      (await serverRuntime.runPromise(memory.inspect(ownerScope))).notes
        .documents.length,
      1
    );
    await assert.rejects(
      personalMemoryProvider.recall["turn.started"](ownerContext)
    );
    await assert.rejects(createNativeTools(ownerContext));
    await assert.rejects(async () =>
      save.execute(
        // The public heterogeneous memory-tool map erases each tool's input type.
        // @ts-expect-error Synthetic input exercises the real native save_memory tool.
        { text: "Must never be saved through a revoked channel" },
        toolContext(ownerContext)
      )
    );
    await assert.rejects(async () =>
      remove.execute(
        // @ts-expect-error Synthetic input exercises the real native remove_memory tool.
        { index: 0 },
        toolContext(ownerContext)
      )
    );
    assert.deepEqual(
      await memoryDocumentBackend.read({
        key: ownerContext.memory.scope.key,
        signal: ownerContext.abortSignal,
      }),
      beforeRevocation
    );
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${otherScope.workspaceId} AND user_id = ${otherScope.userId}`;
      })
    );
    await assert.rejects(
      serverRuntime.runPromise(inspectPersonalMemory(otherHeaders)),
      { reason: "unauthenticated" }
    );
    await assert.rejects(async () =>
      inspectStoredPersonalMemory.execute({}, toolContext(otherContext))
    );
    assert.deepEqual(await fromProcess(other.cookie), {
      status: "Failure",
      reason: "unauthenticated",
    });
    await assert.rejects(
      personalMemoryProvider.recall["turn.started"](otherContext),
      { reason: "unauthenticated" }
    );
    const signedOut = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          origin,
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      })
    );
    assert.equal(signedOut.status, 200);
    await assert.rejects(
      serverRuntime.runPromise(inspectPersonalMemory(ownerHeaders)),
      { reason: "unauthenticated" }
    );
    assert.deepEqual(await fromProcess(owner.cookie), {
      status: "Failure",
      reason: "unauthenticated",
    });
  } finally {
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        for (const key of keys)
          yield* sql`DELETE FROM memory_document WHERE key = ${key}`;
        for (const identity of users) {
          const scope = accessScopeForUser(`better-auth:${identity.userId}`);
          yield* sql`DELETE FROM public.channel_auth_challenge WHERE identity_id = ${identity.id}`;
          yield* sql`DELETE FROM public.channel_identity WHERE id = ${identity.id}`;
          yield* sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`;
          yield* sql`DELETE FROM public."user" WHERE id = ${identity.userId}`;
        }
      })
    );
  }
}, 60_000);
