import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { Config, Effect, Schema } from "effect";
import { test } from "vitest";
import type { MemoryTurnStartedContext } from "eve/memory";
import type { ToolContext } from "eve/tools";
import learnedMemory from "../../server/executor/memory/learned";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const forgottenText = "Minha cor favorita é laranja.";
const incomingText = "Minha bebida favorita é chá.";

const learnedItemListSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String.check(Schema.isUUID()),
    memory: Schema.String,
  })
);

function learnedRecallItems(content: string) {
  const line = content.trim().split("\n").at(-1);
  if (line?.[0] !== "[") return [];
  return Schema.decodeUnknownSync(learnedItemListSchema)(JSON.parse(line));
}

function recallMessage(recall: {
  messages: readonly { content: string; id?: string }[];
}) {
  const message = recall.messages[0];
  assert.ok(message);
  return message;
}

function nextTurn(context: MemoryTurnStartedContext): MemoryTurnStartedContext {
  const operationId = randomUUID();
  const sequence = context.turn.sequence + 1;
  return {
    ...context,
    operationId,
    session: {
      ...context.session,
      turn: { id: operationId, sequence },
    },
    turn: { id: operationId, sequence, input: context.turn.input },
  };
}

async function listLearned(
  sql: Client,
  scope: { workspaceId: string; userId: string }
) {
  const result = await sql.query<{ id: string; memory: string }>(
    `SELECT i.id, i.memory FROM workspace_learned_item i
     JOIN workspace_memory_namespace n ON n.namespace_id = i.namespace_id
     WHERE n.workspace_id = $1 AND n.user_id = $2
     ORDER BY i.id`,
    [scope.workspaceId, scope.userId]
  );
  return result.rows;
}

async function fixture() {
  await Effect.runPromise(Effect.void.pipe(Effect.provide(runtimeDatabase)));
  const sql = new Client({
    connectionString: await Effect.runPromise(Config.string("DATABASE_URL")),
  });
  await sql.connect();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);
  const close = async () => {
    await sql.query(`DELETE FROM public.session WHERE "userId" = $1`, [userId]);
    await sql.query("DELETE FROM workspaces WHERE id = $1", [
      scope.workspaceId,
    ]);
    await sql.query('DELETE FROM "user" WHERE id = $1', [userId]);
    await sql.end();
  };
  try {
    await sql.query(
      'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
      [userId, "Learned race proof", `${userId}@example.invalid`]
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
      principalType: "user" as const,
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
          key: `learned-save-remove-race:${randomUUID()}`,
          namespace: "zoen-learned-v1",
          value: [scope.workspaceId, scope.userId],
        },
        slot: "learned",
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
      getSandbox() {
        throw new Error("Learned memory must not use a sandbox.");
      },
      getSkill() {
        throw new Error("Learned memory must not load skills.");
      },
    };
    const execution: ToolContext = {
      ...context,
      callId: randomUUID(),
      toolName: "learned__save_memory",
      getToken() {
        throw new Error("Learned memory must not use tokens.");
      },
      requireAuth() {
        throw new Error(
          "Learned memory must not request provider authorization."
        );
      },
    };
    const tools = await learnedMemory.provider.tools({
      ...context,
      channel: { kind: "eve" },
    });
    await tools.save_memory.execute({ text: forgottenText }, execution);
    const recall = await learnedMemory.provider.recall["turn.started"](context);
    const original = learnedRecallItems(recallMessage(recall).content).find(
      (item) => item.memory.includes("laranja")
    );
    assert.ok(original);
    const documents = await sql.query(
      "SELECT 1 FROM memory_document WHERE key = $1",
      [context.memory.scope.key]
    );
    assert.equal(documents.rowCount, 0);
    return {
      sql,
      scope,
      context,
      execution,
      save: tools.save_memory,
      remove: tools.remove_memory,
      originalId: original.id,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

test("forgotten learned note stays gone while a concurrent remember commits a different fact", async () => {
  const owner = await fixture();
  try {
    await Promise.all([
      owner.remove.execute(
        { id: owner.originalId },
        {
          ...owner.execution,
          callId: randomUUID(),
          toolName: "learned__remove_memory",
        }
      ),
      owner.save.execute(
        { text: incomingText },
        {
          ...owner.execution,
          callId: randomUUID(),
          toolName: "learned__save_memory",
        }
      ),
    ]);
    const after = await listLearned(owner.sql, owner.scope);
    assert.equal(
      after.some((row) => row.id === owner.originalId),
      false
    );
    assert.equal(
      after.some((row) => row.memory.includes("chá")),
      true
    );
    assert.equal(
      after.some((row) => row.memory.includes("laranja")),
      false
    );
    const recalled = await learnedMemory.provider.recall["turn.started"](
      nextTurn(owner.context)
    );
    const content = recallMessage(recalled).content;
    assert.doesNotMatch(content, /laranja/);
    assert.match(content, /chá/);
  } finally {
    await owner.close();
  }
});

test("remembering forgotten text after removal creates a new learned note id", async () => {
  const owner = await fixture();
  try {
    await owner.remove.execute(
      { id: owner.originalId },
      {
        ...owner.execution,
        callId: randomUUID(),
        toolName: "learned__remove_memory",
      }
    );
    await owner.save.execute(
      { text: forgottenText },
      {
        ...owner.execution,
        callId: randomUUID(),
        toolName: "learned__save_memory",
      }
    );
    const after = await listLearned(owner.sql, owner.scope);
    assert.equal(
      after.some((row) => row.id === owner.originalId),
      false
    );
    const remembered = after.find((row) => row.memory.includes("laranja"));
    assert.ok(remembered);
    assert.notEqual(remembered.id, owner.originalId);
    const recalled = await learnedMemory.provider.recall["turn.started"](
      nextTurn(owner.context)
    );
    const items = learnedRecallItems(recallMessage(recalled).content);
    assert.equal(
      items.some((item) => item.id === owner.originalId),
      false
    );
    assert.ok(items.some((item) => item.memory.includes("laranja")));
  } finally {
    await owner.close();
  }
});
