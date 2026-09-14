import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { waitForBlocked } from "./pg-locks";
import { Client } from "pg";
import { Config, Effect, Schema } from "effect";
import { test } from "vitest";
import type { MemoryTurnStartedContext } from "eve/memory";
import type { ToolContext } from "eve/tools";
import personalInfo from "../../agent/memory/personal_info";
import { channelPrincipal } from "../../server/channels/principal";
import { ChannelAccounts } from "../../server/accounts";
import { serverRuntime } from "../../server/runtime";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";
import { personalMemoryProvider } from "../../server/executor/memory/personal-memory-provider";
import { getAuth } from "../../db/services/auth";
import { channelChallengeSchema } from "../../shared/identity/channel-auth";
import { applicationOrigin } from "../../shared/environment/origin";
import {
  readPersonalProfile,
  replacePersonalProfile,
} from "../../server/personal-memory/profile";
import { emptyUserProfile } from "../../shared/user-profile/schema";

import { authorizePersonalMemoryPrincipal } from "../../server/personal-memory/principal";
import {
  UserProfileError,
  readUserProfile,
  patchUserProfile,
  replaceUserProfile,
} from "../../db/services/user-profile";

async function fixture() {
  await Effect.runPromise(Effect.void.pipe(Effect.provide(runtimeDatabase)));
  const databaseUrl = await Effect.runPromise(Config.string("DATABASE_URL"));
  const sql = new Client({ connectionString: databaseUrl });
  await sql.connect();
  const userId = randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);
  const installation = await Effect.runPromise(
    Config.string("TELEGRAM_BOT_ID")
  );
  const identityId = randomUUID();
  await sql.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
    userId,
    "Profile proof",
    `${userId}@example.invalid`,
  ]);
  await sql.query("INSERT INTO workspaces (id) VALUES ($1)", [
    scope.workspaceId,
  ]);
  await sql.query(
    "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    [scope.workspaceId, scope.userId]
  );
  await sql.query(
    "INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id) VALUES ($1::text::uuid, 'telegram', $2, $1::text, $3), ($4::text::uuid, 'telegram', $2, $4::text, $3)",
    [identityId, installation, userId, randomUUID()]
  );
  const accounts = await serverRuntime.runPromise(ChannelAccounts);
  const identity = await serverRuntime.runPromise(
    accounts.getActiveIdentity({
      channel: "telegram",
      installationId: installation,
      senderId: identityId,
    })
  );
  const principal = channelPrincipal(identity);
  const id = randomUUID();
  const context: MemoryTurnStartedContext = {
    abortSignal: new AbortController().signal,
    memory: {
      scope: {
        key: `profile-proof:${id}`,
        namespace: "openinstinct-personal-info-v1",
        value: scope.workspaceId,
      },
      slot: "personal_info",
    },
    messages: [],
    operationId: id,
    session: {
      id,
      auth: { current: principal, initiator: principal },
      turn: { id, sequence: 1 },
    },
    turn: { id, input: [], sequence: 1 },
    getSandbox() {
      throw new Error("Profile must not use sandbox");
    },
    getSkill() {
      throw new Error("Profile must not use skills");
    },
  };
  const execution: ToolContext = {
    ...context,
    callId: id,
    toolName: "personal_info__update",
    getToken() {
      throw new Error("Profile must not use tokens");
    },
    requireAuth() {
      throw new Error("Profile must not request provider authorization");
    },
  };
  const tools = await personalInfo.provider.tools({
    ...context,
    channel: { kind: "telegram" },
  });
  assert.ok(tools?.update);
  const update = {
    execute: async (...args: Parameters<typeof tools.update.execute>) =>
      await tools.update.execute(...args),
  };
  return {
    sql,
    databaseUrl,
    scope,
    context,
    execution,
    update,
    accounts,
    identityId,
    installation,
    revoke: () =>
      serverRuntime.runPromise(accounts.revokeIdentity({ userId, identityId })),
    async close() {
      await sql.query("DELETE FROM workspaces WHERE id = $1", [
        scope.workspaceId,
      ]);
      await sql.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await sql.end();
    },
  };
}

test("real structured tools correct, forget the last field, supersede recall and reject cross-owner or revoked execution", async () => {
  const owner = await fixture();
  const other = await fixture();
  try {
    await owner.update.execute({ city: "Old city" }, owner.execution);
    await owner.update.execute({ city: "New city" }, owner.execution);
    const corrected = await personalInfo.provider.recall["turn.started"](
      owner.context
    );
    assert.match(corrected?.messages[0]?.content ?? "", /New city/);
    assert.doesNotMatch(corrected?.messages[0]?.content ?? "", /Old city/);
    await assert.rejects(
      owner.update.execute({ city: "Foreign write" }, other.execution)
    );
    await owner.update.execute({ city: null }, owner.execution);
    const forgotten = await personalInfo.provider.recall["turn.started"](
      owner.context
    );
    assert.equal(forgotten?.messages[0]?.id, "user-profile");
    assert.match(forgotten.messages[0].content, /"city":null/);
    assert.doesNotMatch(forgotten.messages[0].content, /New city|Old city/);
    const compacted = await personalInfo.provider.recall[
      "compaction.completed"
    ](owner.context);
    assert.equal(compacted?.messages[0]?.id, "user-profile");
    await owner.revoke();
    await assert.rejects(
      owner.update.execute({ city: "Revoked write" }, owner.execution)
    );
    await assert.rejects(
      personalInfo.provider.recall["turn.started"](owner.context)
    );
    const rows = await owner.sql.query<{ city: string | null }>(
      "SELECT city FROM user_profiles WHERE workspace_id = $1",
      [owner.scope.workspaceId]
    );
    assert.equal(rows.rows[0]?.city, null);
  } finally {
    await owner.close();
    await other.close();
  }
});

test("profile write retains identity authority while blocked on storage; revocation commits only after the write", async () => {
  const owner = await fixture();
  const blocker = new Client({ connectionString: owner.databaseUrl });
  await blocker.connect();
  let pending: Promise<unknown> | undefined;
  let revoked: Promise<unknown> | undefined;
  try {
    await owner.update.execute({ city: "Old city" }, owner.execution);
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT workspace_id FROM user_profiles WHERE workspace_id = $1 FOR UPDATE",
      [owner.scope.workspaceId]
    );
    const pid = (
      await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]?.pid;
    assert.ok(pid);
    pending = owner.update.execute({ city: null }, owner.execution);
    const writerPid = await waitForBlocked(
      owner.sql,
      pid,
      "INSERT INTO user_profiles%"
    );
    revoked = owner.revoke();
    await waitForBlocked(
      owner.sql,
      writerPid,
      "%SELECT id FROM public.channel_identity%FOR UPDATE%"
    );
    await blocker.query("COMMIT");
    await pending;
    await revoked;
    const result = await owner.sql.query<{ city: string | null }>(
      "SELECT city FROM user_profiles WHERE workspace_id = $1",
      [owner.scope.workspaceId]
    );
    assert.equal(result.rows[0]?.city, null);
    await assert.rejects(
      owner.update.execute({ city: "Restored" }, owner.execution)
    );
  } finally {
    await blocker.query("ROLLBACK");
    await Promise.allSettled([pending, revoked]);
    await blocker.end();
    await owner.close();
  }
});

test("concurrent unrelated patch cannot restore a forgotten field", async () => {
  const owner = await fixture();
  try {
    await owner.update.execute(
      { city: "Forget me", firstName: "Old name" },
      owner.execution
    );
    await Promise.all([
      owner.update.execute({ city: null }, owner.execution),
      owner.update.execute({ firstName: "New name" }, owner.execution),
    ]);
    const rows = await owner.sql.query<{
      city: string | null;
      first_name: string | null;
    }>("SELECT city, first_name FROM user_profiles WHERE workspace_id = $1", [
      owner.scope.workspaceId,
    ]);
    assert.deepEqual(rows.rows[0], { city: null, first_name: "New name" });
  } finally {
    await owner.close();
  }
});

test("native note correction and last-note removal replace recalled content across turns and compaction", async () => {
  const owner = await fixture();
  const context = {
    ...owner.context,
    memory: { ...owner.context.memory, slot: "profile" },
  };
  try {
    const tools = await personalMemoryProvider.tools?.({
      ...context,
      channel: { kind: "telegram" },
    });
    assert.ok(tools?.save_memory && tools.remove_memory);
    const save = tools.save_memory;
    const remove = tools.remove_memory;
    await save.execute(
      // @ts-expect-error Native heterogeneous tool maps erase their individual input schemas.
      { text: "My favorite color is orange." },
      owner.execution
    );
    const first = await personalMemoryProvider.recall["turn.started"](context);
    const firstMessage = first?.messages[0];
    const recallId = firstMessage?.id;
    assert.ok(recallId, "Native recall must identify the content it replaces.");
    const oldIndex = /(?:^|\n)(\d+):.*orange/mu.exec(firstMessage.content)?.[1];
    assert.ok(oldIndex, firstMessage.content);
    await save.execute(
      // @ts-expect-error Native heterogeneous tool maps erase their individual input schemas.
      { text: "My favorite color is green." },
      owner.execution
    );
    // @ts-expect-error Native heterogeneous tool maps erase their individual input schemas.
    await remove.execute({ index: Number(oldIndex) }, owner.execution);
    const corrected =
      await personalMemoryProvider.recall["turn.started"](context);
    const content = corrected?.messages[0]?.content ?? "";
    assert.match(content, /green/);
    assert.doesNotMatch(content, /orange/);
    const newIndex = /(?:^|\n)(\d+):.*green/mu.exec(content)?.[1];
    assert.ok(newIndex, content);
    // @ts-expect-error Native heterogeneous tool maps erase their individual input schemas.
    await remove.execute({ index: Number(newIndex) }, owner.execution);
    // Exercise both native lifecycle callbacks in their actual sequence.
    /* oxlint-disable eslint/no-await-in-loop */
    for (const event of ["turn.started", "compaction.completed"] as const) {
      const recalled = await personalMemoryProvider.recall[event]({
        ...context,
        compaction: { modelId: "profile-storage-proof" },
      });
      assert.equal(recalled?.messages[0]?.id, recallId);
      assert.match(recalled.messages[0].content, /No memories are saved/);
      assert.doesNotMatch(recalled.messages[0].content, /orange|green/);
    }
    /* oxlint-enable eslint/no-await-in-loop */
    await owner.revoke();
    await assert.rejects(async () =>
      // @ts-expect-error Native heterogeneous tool maps erase their individual input schemas.
      save.execute({ text: "My favorite color is orange." }, owner.execution)
    );
  } finally {
    await owner.sql.query("DELETE FROM memory_document WHERE key = $1", [
      context.memory.scope.key,
    ]);
    await owner.close();
  }
});

const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

async function login(owner: Awaited<ReturnType<typeof fixture>>) {
  const auth = await getAuth();
  const origin = applicationOrigin();
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
  await serverRuntime.runPromise(
    owner.accounts.confirmChallenge({
      token,
      sender: {
        channel: "telegram",
        installationId: owner.installation,
        senderId: owner.identityId,
      },
    })
  );
  const completed = await request(
    "complete",
    { id: challenge.id },
    cookies(started)
  );
  assert.equal(completed.status, 200);
  const headers = new Headers({ cookie: cookies(completed) });
  const session = await auth.api.getSession({ headers });
  assert.ok(session);
  return { headers, session };
}

test("real web login updates and clears profile; session revocation winning a SQL race rejects the blocked write", async () => {
  const owner = await fixture();
  const blocker = new Client({ connectionString: owner.databaseUrl });
  await blocker.connect();
  let pending: Promise<unknown> | undefined;
  try {
    const { headers, session } = await login(owner);
    const saved = await serverRuntime.runPromise(
      replacePersonalProfile(headers, {
        ...emptyUserProfile,
        city: "Web city",
        countryCode: "br",
      })
    );
    assert.equal(saved.countryCode, "BR");
    assert.equal(
      (await serverRuntime.runPromise(readPersonalProfile(headers))).city,
      "Web city"
    );
    await serverRuntime.runPromise(
      replacePersonalProfile(headers, emptyUserProfile)
    );
    await blocker.query("BEGIN");
    await blocker.query("DELETE FROM public.session WHERE id = $1", [
      session.session.id,
    ]);
    const pid = (
      await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]?.pid;
    assert.ok(pid);
    pending = serverRuntime.runPromise(
      replacePersonalProfile(headers, {
        ...emptyUserProfile,
        city: "Restored after revoke",
      })
    );
    const rejected = assert.rejects(pending);
    await waitForBlocked(
      owner.sql,
      pid,
      "%SELECT id FROM public.session%FOR SHARE%"
    );
    await blocker.query("COMMIT");
    await rejected;
    const result = await owner.sql.query<{ city: string | null }>(
      "SELECT city FROM user_profiles WHERE workspace_id = $1",
      [owner.scope.workspaceId]
    );
    assert.equal(result.rows[0]?.city, null);
    await assert.rejects(
      serverRuntime.runPromise(readPersonalProfile(headers))
    );
  } finally {
    await blocker.query("ROLLBACK");
    await Promise.allSettled([pending]);
    await blocker.end();
    await owner.close();
  }
});

test("mandatory profile authorization preserves concrete errors and denies every service operation after revocation", async () => {
  const owner = await fixture();
  const authorize = authorizePersonalMemoryPrincipal(
    owner.context.session.auth.current
  );
  try {
    await assert.rejects(
      serverRuntime.runPromise(patchUserProfile(authorize, {})),
      UserProfileError
    );
    await assert.rejects(
      serverRuntime.runPromise(
        replaceUserProfile(authorize, {
          ...emptyUserProfile,
          dateOfBirth: "invalid-date",
        })
      ),
      { _tag: "UserProfileError", reason: "invalid_input" }
    );
    await serverRuntime.runPromise(
      patchUserProfile(authorize, { city: "Authorized city" })
    );
    await owner.sql.query(
      "UPDATE user_profiles SET email = 'invalid-email' WHERE workspace_id = $1",
      [owner.scope.workspaceId]
    );
    await assert.rejects(serverRuntime.runPromise(readUserProfile(authorize)), {
      _tag: "UserProfileError",
      reason: "invalid_stored_profile",
    });
    await owner.revoke();
    for (const operation of [
      readUserProfile(authorize),
      patchUserProfile(authorize, { city: "Denied city" }),
      replaceUserProfile(authorize, emptyUserProfile),
    ]) {
      // Each operation must independently evaluate the same live authorization effect.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await assert.rejects(serverRuntime.runPromise(operation), {
        reason: "unauthenticated",
      });
    }
    const result = await owner.sql.query<{ city: string | null }>(
      "SELECT city FROM user_profiles WHERE workspace_id = $1",
      [owner.scope.workspaceId]
    );
    assert.equal(result.rows[0]?.city, "Authorized city");
  } finally {
    await owner.close();
  }
});

test("profile read retains authorization in its own transaction while blocked on storage", async () => {
  const owner = await fixture();
  const blocker = new Client({ connectionString: owner.databaseUrl });
  await blocker.connect();
  let pending: Promise<unknown> | undefined;
  let revoked: Promise<unknown> | undefined;
  try {
    await owner.update.execute({ city: "Authorized city" }, owner.execution);
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE user_profiles IN ACCESS EXCLUSIVE MODE");
    const pid = (
      await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]?.pid;
    assert.ok(pid);
    const read = serverRuntime.runPromise(
      readUserProfile(
        authorizePersonalMemoryPrincipal(owner.context.session.auth.current)
      )
    );
    pending = read;
    const readerPid = await waitForBlocked(
      owner.sql,
      pid,
      "%SELECT%FROM user_profiles%"
    );
    revoked = owner.revoke();
    await waitForBlocked(
      owner.sql,
      readerPid,
      "%SELECT id FROM public.channel_identity%FOR UPDATE%"
    );
    await blocker.query("COMMIT");
    assert.equal((await read).city, "Authorized city");
    await revoked;
    await assert.rejects(
      serverRuntime.runPromise(
        readUserProfile(
          authorizePersonalMemoryPrincipal(owner.context.session.auth.current)
        )
      ),
      { reason: "unauthenticated" }
    );
  } finally {
    await blocker.query("ROLLBACK");
    await Promise.allSettled([pending, revoked]);
    await blocker.end();
    await owner.close();
  }
});
