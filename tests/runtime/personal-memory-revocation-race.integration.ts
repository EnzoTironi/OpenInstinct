import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { Config, Effect, Schema } from "effect";
import { expect, test } from "vitest";
import type { MemoryTurnStartedContext } from "eve/memory";
import type { ToolContext } from "eve/tools";
import { getAuth } from "../../db/services/auth";
import { applicationOrigin } from "../../shared/environment/origin";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { channelChallengeSchema } from "../../shared/identity/channel-auth";
import { ChannelAccounts } from "../../server/accounts";
import { serverRuntime } from "../../server/runtime";
import { channelPrincipal } from "../../agent/lib/channel-session";
import { personalMemoryProvider } from "../../agent/lib/personal-memory-provider";

const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

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
      const challenge = Schema.decodeUnknownSync(channelChallengeSchema)(
        await started.json()
      );
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
      const principal =
        authority === "channel"
          ? channelPrincipal(identity)
          : {
              principalId: scope.userId,
              principalType: "user" as const,
              authenticator: "authjs",
              attributes: {
                conversationChannel: "eve",
                workspaceId,
                authSessionId: session.session.id,
              },
            };
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
        getSandbox() {
          throw new Error("No sandbox belongs in this memory proof");
        },
        getSkill() {
          throw new Error("No skill belongs in this memory proof");
        },
      };
      const execution: ToolContext = {
        ...context,
        callId: randomUUID(),
        toolName: "profile__save_memory",
        getToken() {
          throw new Error("No connection belongs in this memory proof");
        },
        requireAuth() {
          throw new Error(
            "No external authorization belongs in this memory proof"
          );
        },
      };
      const tools = await personalMemoryProvider.tools?.({
        ...context,
        channel: { kind: "http" },
      });
      const save = tools?.save_memory;
      assert.ok(save);
      const invoke = async (text: string) => {
        // @ts-expect-error The heterogeneous public map erases the native tool input type.
        await save.execute({ text }, execution);
      };
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
      write = invoke("Racing write").then(
        () => ({ ok: true }),
        () => ({ ok: false })
      );
      let writerPid: number | undefined;
      await expect
        .poll(
          async () => {
            const rows = await database.query<{ pid: number }>(
              "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND query ILIKE '%UPDATE%memory_document%'",
              [blockerPid]
            );
            writerPid = rows.rows[0]?.pid;
            return writerPid !== undefined;
          },
          { timeout: 5000, interval: 20 }
        )
        .toBe(true);
      const revocation = { completed: false };
      revoke = (async () => {
        if (authority === "channel") {
          await serverRuntime.runPromise(
            accounts.revokeIdentity({
              identityId: identity.id,
              userId: identity.userId,
            })
          );
        } else {
          const response = await auth.handler(
            new Request(`${origin}/api/auth/sign-out`, {
              method: "POST",
              headers: { origin, cookie, "content-type": "application/json" },
              body: "{}",
            })
          );
          assert.equal(response.status, 200);
        }
        revocation.completed = true;
      })();
      // Establish order from database locks, not an assumed sleep duration.
      await expect
        .poll(
          async () => {
            if (revocation.completed) return true;
            const rows = await database.query<{ pid: number }>(
              "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
              [writerPid]
            );
            return rows.rowCount !== 0;
          },
          { timeout: 5000, interval: 20 }
        )
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
      if (revocationWon) {
        assert.deepEqual(
          after,
          before,
          "Revocation completed before releasing the document lock, but the native tool still committed a write"
        );
        assert.equal(outcome.ok, false);
      } else {
        // The writer held an authority lock: revocation could finish only after its transaction ended.
        assert.match(after.content, /Racing write/);
      }
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
      if (userId) {
        await database.query(
          "DELETE FROM channel_auth_challenge WHERE identity_id IN (SELECT id FROM channel_identity WHERE user_id=$1)",
          [userId]
        );
        await database.query("DELETE FROM channel_identity WHERE user_id=$1", [
          userId,
        ]);
        await database.query("DELETE FROM workspaces WHERE id=$1", [
          workspaceId,
        ]);
        await database.query('DELETE FROM "user" WHERE id=$1', [userId]);
      }
      await blocker.end();
      await database.end();
    }
  }, 30_000);
}
