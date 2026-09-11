import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Context } from "effect";
import { Config, Effect, Schema } from "effect";
import type { MemoryTurnStartedContext } from "eve/memory";
import type { ToolContext } from "eve/tools";
import { Client } from "pg";
import { expect, test } from "vitest";

import { personalMemoryProvider } from "../../agent/lib/personal-memory-provider";
import { getAuth } from "../../db/services/auth";
import { ChannelAccounts } from "../../server/accounts";
import { channelPrincipal } from "../../server/channels/principal";
import { serverRuntime } from "../../server/runtime";
import { applicationOrigin } from "../../shared/environment/origin";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { channelChallengeSchema } from "../../shared/identity/channel-auth";
import { executeErasedTool } from "./_lib/execute-erased-tool";

const decodeChannelChallengeSchema = Schema.decodeUnknownSync(
  channelChallengeSchema
);

const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

type ServiceOf<S> =
  S extends Context.Service<infer _I, infer Api> ? Api : never;

type AccountsService = ServiceOf<typeof ChannelAccounts>;

type AuthApi = Awaited<ReturnType<typeof getAuth>>;

type ErasedTool = Parameters<typeof executeErasedTool>[0];

interface WriterPidSlot {
  pid?: number;
}

const raceSandboxUnavailable = () => {
  throw new Error("No sandbox belongs in this memory proof");
};

const raceSkillUnavailable = () => {
  throw new Error("No skill belongs in this memory proof");
};

const raceTokenUnavailable = () => {
  throw new Error("No connection belongs in this memory proof");
};

const raceAuthUnavailable = () => {
  throw new Error("No external authorization belongs in this memory proof");
};

const channelOrWebPrincipal = (input: {
  readonly authority: "channel" | "web";
  readonly identity: Parameters<typeof channelPrincipal>[0];
  readonly scope: ReturnType<typeof accessScopeForUser>;
  readonly workspaceId: string;
  readonly authSessionId: string;
}) => {
  if (input.authority === "channel") {
    return channelPrincipal(input.identity);
  }

  return {
    principalId: input.scope.userId,
    principalType: "user" as const,
    authenticator: "authjs",
    attributes: {
      conversationChannel: "eve",
      workspaceId: input.workspaceId,
      authSessionId: input.authSessionId,
    },
  };
};

const makeMemorySaveInvoker = (save: ErasedTool, execution: ToolContext) => {
  return async (text: string) => {
    await executeErasedTool(save, { text }, execution);
  };
};

const asWriteOutcome = (promise: Promise<void>) =>
  promise.then(
    () => ({ ok: true as const }),
    () => ({ ok: false as const })
  );

const makeWriterBlockedPoll = (
  database: Client,
  blockerPid: number,
  slot: WriterPidSlot
) => {
  return async () => {
    const rows = await database.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND query ILIKE '%UPDATE%memory_document%'",
      [blockerPid]
    );

    slot.pid = rows.rows[0]?.pid;

    return slot.pid !== undefined;
  };
};

const makeRevocationBlockedPoll = (
  database: Client,
  writerPid: number | undefined,
  revocation: { completed: boolean }
) => {
  return async () => {
    if (revocation.completed) return true;

    const rows = await database.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [writerPid]
    );

    return rows.rowCount !== 0;
  };
};

const runAuthorityRevocation = async (input: {
  readonly authority: "channel" | "web";
  readonly accounts: AccountsService;
  readonly identity: { id: string; userId: string };
  readonly auth: AuthApi;
  readonly origin: string;
  readonly cookie: string;
  readonly revocation: { completed: boolean };
}) => {
  if (input.authority === "channel") {
    await serverRuntime.runPromise(
      input.accounts.revokeIdentity({
        identityId: input.identity.id,
        userId: input.identity.userId,
      })
    );
  } else {
    const response = await input.auth.handler(
      new Request(`${input.origin}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          origin: input.origin,
          cookie: input.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      })
    );

    assert.equal(response.status, 200);
  }

  input.revocation.completed = true;
};

const assertRaceOutcome = (
  revocationWon: boolean,
  after: { content: string; version: string },
  before: { content: string; version: string },
  outcome: { ok: boolean }
) => {
  if (revocationWon) {
    assert.deepEqual(
      after,
      before,
      "Revocation completed before releasing the document lock, but the native tool still committed a write"
    );
    assert.equal(outcome.ok, false);

    return;
  }

  // The writer held an authority lock: revocation could finish only after its transaction ended.
  assert.match(after.content, /Racing write/);
};

const deleteRaceUserRows = async (
  database: Client,
  userId: string | undefined,
  workspaceId: string | undefined
) => {
  if (!userId) return;

  await database.query(
    "DELETE FROM channel_auth_challenge WHERE identity_id IN (SELECT id FROM channel_identity WHERE user_id=$1)",
    [userId]
  );
  await database.query("DELETE FROM channel_identity WHERE user_id=$1", [
    userId,
  ]);
  await database.query("DELETE FROM workspaces WHERE id=$1", [workspaceId]);
  await database.query('DELETE FROM "user" WHERE id=$1', [userId]);
};

for (const authority of ["channel", "web"] as const) {
  test(`${authority} revocation linearizes with native memory writes waiting on a real row lock`, async () => {
    const url = await Effect.runPromise(Config.string("DATABASE_URL"));
    const database = new Client({ connectionString: url });
    const blocker = new Client({ connectionString: url });
    await database.connect();
    await blocker.connect();
    const key = `memory-revocation-race:${randomUUID()}`;
    let userId: string | undefined;
    let workspaceId: string | undefined;
    let write: Promise<{ ok: boolean }> | undefined;
    let revoke: Promise<void> | undefined;

    try {
      assert.equal(
        (
          await database.query<{ name: string }>(
            "SELECT current_database() AS name"
          )
        ).rows[0]?.name,
        "companion_runtime_test"
      );
      const auth = await getAuth();
      const accounts = await serverRuntime.runPromise(ChannelAccounts);
      const origin = applicationOrigin();

      const installationId = await Effect.runPromise(
        Config.string("TELEGRAM_BOT_ID")
      );

      const started = await auth.handler(
        new Request(`${origin}/api/auth/channel-auth/start`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ channel: "telegram", purpose: "login" }),
        })
      );

      assert.equal(started.status, 200);

      const challenge = decodeChannelChallengeSchema(await started.json());

      const token = new URL(challenge.deepLink).searchParams.get("start");
      assert.ok(token);

      const sender = {
        channel: "telegram" as const,
        installationId,
        senderId: randomUUID(),
      };

      await serverRuntime.runPromise(
        accounts.confirmChallenge({ token, sender })
      );

      const completed = await auth.handler(
        new Request(`${origin}/api/auth/channel-auth/complete`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            cookie: cookieHeader(started),
          },
          body: JSON.stringify({ id: challenge.id }),
        })
      );

      assert.equal(completed.status, 200);
      const cookie = cookieHeader(completed);

      const identity = await serverRuntime.runPromise(
        accounts.getActiveIdentity(sender)
      );

      userId = identity.userId;
      const scope = accessScopeForUser(`better-auth:${userId}`);
      workspaceId = scope.workspaceId;
      // A second synthetic linked identity keeps revokeIdentity's last-access rule intact.
      const secondId = randomUUID();
      await database.query(
        "INSERT INTO channel_identity (id,channel,installation_id,sender_id,user_id) VALUES ($1,'telegram',$2,$3,$4)",
        [secondId, installationId, secondId, userId]
      );

      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });

      assert.ok(session);

      const principal = channelOrWebPrincipal({
        authority,
        identity,
        scope,
        workspaceId,
        authSessionId: session.session.id,
      });

      const turnId = randomUUID();

      const context: MemoryTurnStartedContext = {
        abortSignal: new AbortController().signal,
        memory: {
          scope: {
            key,
            namespace: "memory-revocation-race",
            value: workspaceId,
          },
          slot: "profile",
        },
        messages: [],
        operationId: randomUUID(),
        session: {
          id: randomUUID(),
          auth: { current: principal, initiator: principal },
          turn: { id: turnId, sequence: 1 },
        },
        turn: { id: turnId, input: [], sequence: 1 },
        getSandbox: raceSandboxUnavailable,
        getSkill: raceSkillUnavailable,
      };

      const execution: ToolContext = {
        ...context,
        callId: randomUUID(),
        toolName: "profile__save_memory",
        getToken: raceTokenUnavailable,
        requireAuth: raceAuthUnavailable,
      };

      const tools = await personalMemoryProvider.tools?.({
        ...context,
        channel: { kind: "http" },
      });

      const save = tools?.save_memory;
      assert.ok(save);

      const invoke = makeMemorySaveInvoker(save, execution);

      await invoke("Before revocation");

      const before = (
        await database.query<{ content: string; version: string }>(
          "SELECT content,version FROM memory_document WHERE key=$1",
          [key]
        )
      ).rows[0];

      assert.ok(before);
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT key FROM memory_document WHERE key=$1 FOR UPDATE",
        [key]
      );

      const blockerPid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]?.pid;

      assert.ok(blockerPid);
      write = asWriteOutcome(invoke("Racing write"));
      const writerSlot: WriterPidSlot = {};
      await expect
        .poll(makeWriterBlockedPoll(database, blockerPid, writerSlot), {
          timeout: 5000,
          interval: 20,
        })
        .toBe(true);
      const writerPid = writerSlot.pid;
      const revocation = { completed: false };
      revoke = runAuthorityRevocation({
        authority,
        accounts,
        identity,
        auth,
        origin,
        cookie,
        revocation,
      });
      // Establish order from database locks, not an assumed sleep duration.
      await expect
        .poll(makeRevocationBlockedPoll(database, writerPid, revocation), {
          timeout: 5000,
          interval: 20,
        })
        .toBe(true);
      const revocationWon = revocation.completed;
      await blocker.query("COMMIT");
      const outcome = await write;
      await revoke;

      const after = (
        await database.query<{ content: string; version: string }>(
          "SELECT content,version FROM memory_document WHERE key=$1",
          [key]
        )
      ).rows[0];

      assert.ok(after);

      assertRaceOutcome(revocationWon, after, before, outcome);

      const frozen = after;
      await assert.rejects(invoke("Must not persist after revocation"));
      assert.deepEqual(
        (
          await database.query<{ content: string; version: string }>(
            "SELECT content,version FROM memory_document WHERE key=$1",
            [key]
          )
        ).rows[0],
        frozen
      );
      assert.equal(
        (
          await database.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM workspace_memberships WHERE workspace_id=$1",
            [workspaceId]
          )
        ).rows[0]?.n,
        1
      );
    } finally {
      await blocker.query("ROLLBACK");
      await Promise.allSettled([write, revoke]);
      await database.query("DELETE FROM memory_document WHERE key=$1", [key]);

      await deleteRaceUserRows(database, userId, workspaceId);

      await blocker.end();
      await database.end();
    }
  }, 30_000);
}
