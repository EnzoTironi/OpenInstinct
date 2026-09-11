import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { Config, Effect } from "effect";
import type { MemoryTurnStartedContext } from "eve/memory";
import { fileMemory } from "eve/memory/file";
import type { ToolContext } from "eve/tools";
import { Client } from "pg";
import { test } from "vitest";

import { createMemoryDocumentBackend } from "../../agent/lib/memory-document-backend";
import { authorizePersonalMemoryContext } from "../../agent/lib/personal-memory-access";
import { personalMemoryProvider } from "../../agent/lib/personal-memory-provider";
import { PersonalMemoryError } from "../../server/personal-memory/access";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { executeErasedTool } from "./_lib/execute-erased-tool";
import { runtimeDatabase } from "./database";
import { waitForBlocked } from "./pg-locks";

const forgottenText = "My favorite color is orange.";

const incomingText = "My favorite drink is tea.";

const nativeSandboxUnavailable = () => {
  throw new Error("Native file memory must not use a sandbox.");
};

const nativeSkillUnavailable = () => {
  throw new Error("Native file memory must not load skills.");
};

const nativeTokenUnavailable = () => {
  throw new Error("Native file memory must not use tokens.");
};

const nativeAuthUnavailable = () => {
  throw new Error(
    "Native file memory must not request provider authorization."
  );
};

const hasSaveAndRemove = (
  tools:
    | {
        save_memory?: unknown;
        remove_memory?: unknown;
      }
    | null
    | undefined
) => Boolean(tools?.save_memory && tools.remove_memory);

const recallLineIndex = (content: string | undefined) =>
  /(?:^|\n)(\d+):.*orange/mu.exec(content ?? "")?.[1];

const makeNativeRaceClose =
  (
    sql: Client,
    key: string,
    scope: ReturnType<typeof accessScopeForUser>,
    userId: string
  ) =>
  async () => {
    await sql.query("SELECT pg_advisory_unlock_all()");
    await sql.query("DELETE FROM memory_document WHERE key = $1", [key]);
    await sql.query("DELETE FROM workspaces WHERE id = $1", [
      scope.workspaceId,
    ]);
    await sql.query('DELETE FROM "user" WHERE id = $1', [userId]);
    await sql.end();
  };

async function fixture() {
  await Effect.runPromise(Effect.void.pipe(Effect.provide(runtimeDatabase)));

  const sql = new Client({
    connectionString: await Effect.runPromise(Config.string("DATABASE_URL")),
  });

  await sql.connect();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);
  const key = `native-save-remove-race:${randomUUID()}`;

  const close = makeNativeRaceClose(sql, key, scope, userId);

  try {
    await sql.query(
      'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
      [userId, "Native race proof", `${userId}@example.invalid`]
    );
    await sql.query("INSERT INTO workspaces (id) VALUES ($1)", [
      scope.workspaceId,
    ]);
    await sql.query(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [scope.workspaceId, scope.userId]
    );
    await sql.query(
      `INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES ($1, $2, $3, clock_timestamp() + interval '10 minutes', clock_timestamp())`,
      [sessionId, randomUUID(), userId]
    );

    const principal = {
      principalId: scope.userId,
      principalType: "user",
      authenticator: "authjs",
      attributes: {
        workspaceId: scope.workspaceId,
        authSessionId: sessionId,
        conversationChannel: "eve",
      },
    };

    const context: MemoryTurnStartedContext = {
      memory: {
        scope: {
          key,
          namespace: "native-save-remove-race",
          value: scope.workspaceId,
        },
        slot: "profile",
      },
      session: {
        id: sessionId,
        auth: { current: principal, initiator: principal },
        turn: { id: randomUUID(), sequence: 1 },
      },
      turn: { id: randomUUID(), sequence: 1, input: [] },
      operationId: randomUUID(),
      messages: [],
      abortSignal: new AbortController().signal,
      getSandbox: nativeSandboxUnavailable,
      getSkill: nativeSkillUnavailable,
    };

    const execution: ToolContext = {
      ...context,
      callId: randomUUID(),
      toolName: "profile__save_memory",
      getToken: nativeTokenUnavailable,
      requireAuth: nativeAuthUnavailable,
    };

    const tools = await personalMemoryProvider.tools?.({
      ...context,
      channel: { kind: "eve" },
    });

    assert.ok(hasSaveAndRemove(tools));
    await executeErasedTool(
      tools.save_memory,
      { text: forgottenText },
      execution
    );
    const recall = await personalMemoryProvider.recall["turn.started"](context);

    const index = recallLineIndex(recall?.messages[0]?.content);

    assert.ok(index);

    return {
      sql,
      context,
      execution,
      remove: tools.remove_memory,
      originalIndex: Number(index),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

const readDocument = async (sql: Client, key: string) => {
  const result = await sql.query<{ content: string; version: string }>(
    "SELECT content, version FROM memory_document WHERE key = $1",
    [key]
  );

  const document = result.rows[0];
  assert.ok(document);

  return document;
};

async function runRace(blockedOperation: 1 | 2, text: string) {
  const owner = await fixture();
  const gateKey = randomInt(1, 2_147_483_647);
  let operations = 0;
  let pending: Promise<unknown> | undefined;

  try {
    const before = await readDocument(
      owner.sql,
      owner.context.memory.scope.key
    );

    await owner.sql.query("SELECT pg_advisory_lock($1::bigint)", [gateKey]);

    const pid = (
      await owner.sql.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]?.pid;

    assert.ok(pid);

    // The real guard and backend execute unchanged. Only this save's selected authorization
    // transaction waits on an actual PG operation, before document I/O acquires its row lock.
    const authorize = Effect.gen(function* () {
      yield* authorizePersonalMemoryContext(owner.context);
      operations += 1;

      if (operations === blockedOperation) {
        const sql = yield* PgClient.PgClient;
        yield* sql`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`.pipe(
          Effect.mapError(
            () => new PersonalMemoryError({ reason: "unavailable" })
          )
        );
      }
    });

    const native = fileMemory({
      backend: createMemoryDocumentBackend(authorize),
    });

    const tools = await native.tools?.({
      ...owner.context,
      channel: { kind: "eve" },
    });

    assert.ok(tools?.save_memory);
    pending = Promise.resolve(
      executeErasedTool(
        tools.save_memory,
        { text },
        { ...owner.execution, callId: randomUUID() }
      )
    );

    const blockedPid = await waitForBlocked(
      owner.sql,
      pid,
      "%pg_advisory_xact_lock%"
    );

    assert.equal(operations, blockedOperation);
    await executeErasedTool(
      owner.remove,
      { index: owner.originalIndex },
      {
        ...owner.execution,
        callId: randomUUID(),
        toolName: "profile__remove_memory",
      }
    );

    const removed = await readDocument(
      owner.sql,
      owner.context.memory.scope.key
    );

    assert.notEqual(removed.version, before.version);
    assert.doesNotMatch(removed.content, /orange|tea/);
    // Removal committed while the old save is still visibly blocked inside PostgreSQL.
    assert.equal(
      await waitForBlocked(owner.sql, pid, "%pg_advisory_xact_lock%"),
      blockedPid
    );
    await owner.sql.query("SELECT pg_advisory_unlock($1::bigint)", [gateKey]);
    await pending;
    const after = await readDocument(owner.sql, owner.context.memory.scope.key);

    const recalled = await personalMemoryProvider.recall["turn.started"](
      owner.context
    );

    return {
      before,
      removed,
      after,
      operations,
      originalIndex: owner.originalIndex,
      recall: recalled?.messages[0]?.content ?? "",
    };
  } finally {
    await owner.sql.query("SELECT pg_advisory_unlock($1::bigint)", [gateKey]);
    await Promise.allSettled([pending]);
    await owner.close();
  }
}

test("stale native snapshot retries after removal without restoring the forgotten entry", async () => {
  const result = await runRace(2, incomingText);
  assert.doesNotMatch(result.after.content, /orange/);
  assert.match(result.after.content, /tea/);
  assert.doesNotMatch(result.recall, /orange/);
  assert.match(result.recall, /tea/);
  assert.equal(
    result.operations,
    4,
    "Initial read/write conflict followed by a fresh read/write"
  );
  assert.notEqual(result.after.version, result.removed.version);
});

test("a delayed native save of the same incoming text creates a new entry after removal", async () => {
  const result = await runRace(1, forgottenText);
  assert.match(result.after.content, /orange/);
  assert.match(result.recall, /orange/);
  const newIndex = /(?:^|\n)(\d+):.*orange/mu.exec(result.recall)?.[1];
  assert.ok(newIndex);
  assert.ok(Number(newIndex) > result.originalIndex);
  assert.equal(
    result.operations,
    2,
    "The delayed read sees the removal, then writes its explicit incoming text"
  );
  assert.notEqual(result.after.version, result.removed.version);
});
