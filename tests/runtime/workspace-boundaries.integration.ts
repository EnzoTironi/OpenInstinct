import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Result } from "effect";
import type { SessionAuthContext } from "eve/context";
import { expect, test, vi } from "vitest";
import { ensureScope } from "../../db/services/scope";
import { claimSession } from "../../db/services/sessions";
import { ChannelAccounts } from "../../server/accounts";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { Kapso } from "../../server/channels/kapso";
import { Telegram } from "../../server/channels/telegram";
import { ChannelTransport } from "../../server/channels/transport";
import { Messaging } from "../../server/messaging";
import { dispatchNativeScheduledReport } from "../../server/schedules/native-report";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../server/workspaces/access";
import {
  issueAgentGrant,
  saveWorkspaceBot,
} from "../../server/workspaces/bots";
import { getWorkspaceGoogleToken } from "../../server/workspaces/connections";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import {
  answerWorkspaceInvitation,
  inviteWorkspaceMember,
  readWorkspaceTeam,
  removeWorkspaceMember,
} from "../../server/workspaces/team";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { runtimeDatabase } from "./database";
import { linkedIdentity } from "./identity-fixture";
import { workspaceFixture } from "./workspace-fixture";

// vi.mock factories are hoisted above the static imports, so effect is loaded inside.
vi.mock("../../db/services/auth", async () => {
  const { Effect: Fx } = await import("effect");
  return {
    authentication: Fx.succeed({
      $context: Promise.resolve({
        secretConfig: "synthetic-connection-key-for-tests-only",
      }),
    }),
  };
});

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
const reportServices = ChannelTransport.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      ChannelAccounts.layer,
      Messaging.layer,
      Telegram.layer,
      Kapso.layer,
      WorkspaceRepository.layer
    )
  ),
  Layer.provideMerge(runtimeDatabase)
);
const denied = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
    WorkspaceAccessDenied
  );
};
const emptyWorkspace = Effect.fn("emptyWorkspace.fixture")(function* (
  sql: PgClient.PgClient,
  teamWorkspaceId: string
) {
  const id = `team-other-${randomUUID()}`;
  yield* Effect.addFinalizer(() =>
    sql`DELETE FROM workspaces WHERE id = ${id}`.pipe(Effect.orDie)
  );
  yield* sql`INSERT INTO workspaces (id, organization_id)
    SELECT ${id}::text, organization_id FROM workspaces WHERE id = ${teamWorkspaceId}`;
  return id;
});
const durableAuthority = (
  sql: PgClient.PgClient,
  ids: {
    readonly jobId: string;
    readonly grantId: string;
    readonly taskId: string;
    readonly sessionId: string;
  }
) =>
  sql<{
    job: string | null;
    grantRevoked: boolean | null;
    task: string | null;
    sessions: number;
  }>`SELECT
    (SELECT status FROM scheduled_agent_jobs WHERE id = ${ids.jobId}) AS job,
    (SELECT revoked_at IS NOT NULL FROM workspace_agent_grants WHERE id = ${ids.grantId}) AS "grantRevoked",
    (SELECT state FROM agent_protocol_tasks WHERE id = ${ids.taskId}) AS task,
    (SELECT count(*)::int FROM agent_sessions WHERE session_id = ${ids.sessionId}) AS sessions`;

test("SP08: a copied or edited workspace id grants nothing without a current membership", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor, guest, personal } = yield* workspaceFixture();
      const other = yield* emptyWorkspace(sql, actor.workspaceId);
      denied(
        yield* requireWorkspaceAccess({ ...guest, workspaceId: other }).pipe(
          Effect.result
        )
      );
      denied(
        yield* requireWorkspaceAccess({ ...actor, workspaceId: other }).pipe(
          Effect.result
        )
      );
      denied(
        yield* requireWorkspaceAccess({
          ...guest,
          workspaceId: personal.workspaceId,
        }).pipe(Effect.result)
      );
      expect((yield* requireWorkspaceAccess(guest)).role).toBe("member");
      yield* Effect.promise(() =>
        assert.rejects(
          ensureScope({ userId: guest.userId, workspaceId: other }),
          { _tag: "ScopeAccessDenied" }
        )
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("SP07: a guest reaches only the granted scope and none of its management", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor, guest, repository } = yield* workspaceFixture();
      const other = yield* emptyWorkspace(sql, actor.workspaceId);
      yield* repository.write(actor, {
        operationId: randomUUID(),
        path: "knowledge/team.md",
        content: "Shared with members",
        expectedRevision: null,
      });
      denied(
        yield* repository
          .read({ ...guest, workspaceId: other })
          .pipe(Effect.result)
      );
      expect((yield* repository.read(guest)).files).toEqual([
        "knowledge/team.md",
      ]);
      denied(
        yield* inviteWorkspaceMember(guest, "anyname").pipe(Effect.result)
      );
      expect((yield* readWorkspaceTeam(guest)).mayManage).toBe(false);
      denied(
        yield* issueAgentGrant(guest, {
          label: "x",
          capabilities: ["files"],
          days: 1,
        }).pipe(Effect.result)
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("SP05: removing a member ends every durable authority they held in the workspace", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor, guest, guestPersonal } = yield* workspaceFixture();
      const scope = { userId: guest.userId, workspaceId: guest.workspaceId };
      const ids = {
        jobId: randomUUID(),
        grantId: randomUUID(),
        taskId: randomUUID(),
        sessionId: `session-${randomUUID()}`,
      };
      yield* sql`INSERT INTO scheduled_agent_jobs(id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, next_run_at)
        VALUES (${ids.jobId}, ${guest.workspaceId}, ${guest.userId}, 'Synthetic schedule', 'eve', ${randomUUID()}, '{"kind":"once","at":"2030-01-01T12:00:00Z"}', '2030-01-01T12:00:00Z')`;
      const bot = yield* saveWorkspaceBot(actor, {
        username: `b${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        name: "Test Zoen",
        description: "Synthetic knowledge assistant",
        discoverable: false,
      });
      yield* sql`INSERT INTO workspace_agent_grants(id, bot_id, issued_by, label, token_hash, capabilities, expires_at)
        VALUES (${ids.grantId}, ${bot.id}, ${guest.userId}, 'Issued by the guest', ${createHash("sha256").update(randomUUID()).digest("hex")}, ${JSON.stringify(["files"])}::jsonb, now() + interval '1 day')`;
      yield* sql`INSERT INTO agent_protocol_tasks(id, grant_id, context_id, message_id, request_hash, prompt, state)
        VALUES (${ids.taskId}, ${ids.grantId}, ${randomUUID()}, ${randomUUID()}, ${createHash("sha256").update("Synthetic task").digest("hex")}, 'Synthetic task', 'TASK_STATE_WORKING')`;
      yield* Effect.promise(() => claimSession(scope, ids.sessionId));
      yield* sql`INSERT INTO workspace_connections(workspace_id, label, credentials, connected_by)
        VALUES (${actor.workspaceId}, 'shared@example.invalid', 'not-a-ciphertext', ${actor.userId})`;
      expect(yield* durableAuthority(sql, ids)).toEqual([
        {
          job: "active",
          grantRevoked: false,
          task: "TASK_STATE_WORKING",
          sessions: 1,
        },
      ]);
      const reachable = yield* getWorkspaceGoogleToken(scope).pipe(
        Effect.result
      );
      expect(Result.isFailure(reachable) && reachable.failure).toMatchObject({
        reason: "unavailable",
      });
      yield* removeWorkspaceMember(actor, guest.userId);
      denied(yield* requireWorkspaceAccess(guest).pipe(Effect.result));
      yield* Effect.promise(() =>
        assert.rejects(ensureScope(scope), { _tag: "ScopeAccessDenied" })
      );
      expect(yield* durableAuthority(sql, ids)).toEqual([
        {
          job: null,
          grantRevoked: true,
          task: "TASK_STATE_CANCELED",
          sessions: 0,
        },
      ]);
      const unreachable = yield* getWorkspaceGoogleToken(scope).pipe(
        Effect.result
      );
      expect(
        Result.isFailure(unreachable) && unreachable.failure
      ).toMatchObject({ reason: "authorization_required" });
      expect((yield* requireWorkspaceAccess(guestPersonal)).role).toBe("owner");
      expect(
        (yield* readWorkspaceTeam(actor)).members.map((member) => member.userId)
      ).toEqual([actor.userId]);
      expect(
        yield* sql`SELECT metadata FROM organization_audit_receipts
          WHERE action = 'member_removed' AND target_user_id = ${guest.userId}
          ORDER BY created_at DESC LIMIT 1`
      ).toEqual([
        {
          metadata: {
            removedSessions: 1,
            removedJobs: 1,
            cancelledOutbox: 0,
            revokedGrants: 1,
            canceledTasks: 1,
          },
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("SP06: a group cannot act in the owner's personal space or reach personal scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor, guest, personal } = yield* workspaceFixture();
      const installationId = `group-${randomUUID()}`;
      const owner = yield* linkedIdentity(
        { channel: "telegram", installationId, senderId: "owner" },
        { userId: actor.userId.slice("better-auth:".length) }
      );
      const principal: SessionAuthContext = {
        principalType: "user",
        principalId: actor.userId,
        authenticator: "verified-channel",
        attributes: {
          workspaceId: personal.workspaceId,
          chatKind: "group",
          channelIdentityId: owner.id,
        },
      };
      denied(yield* workspaceActorFromPrincipal(principal).pipe(Effect.result));
      assert.throws(() => scopeFromPrincipal(principal), {
        _tag: "PrincipalScopeError",
      });
      const member = yield* linkedIdentity(
        { channel: "telegram", installationId, senderId: "member" },
        { userId: guest.userId.slice("better-auth:".length) }
      );
      const teamBinding = randomUUID();
      const personalBinding = randomUUID();
      yield* sql`INSERT INTO workspace_group_bindings(id, workspace_id, channel, installation_id, conversation_id, label, created_by) VALUES
        (${teamBinding}, ${guest.workspaceId}, 'telegram', ${installationId}, ${randomUUID()}, 'Team group', ${actor.userId}),
        (${personalBinding}, ${personal.workspaceId}, 'telegram', ${installationId}, ${randomUUID()}, 'Owner group', ${actor.userId})`;
      const group = {
        userId: guest.userId,
        workspaceId: guest.workspaceId,
        channelIdentityId: member.id,
        groupBindingId: teamBinding,
      };
      expect((yield* requireWorkspaceAccess(group)).role).toBe("member");
      yield* sql`UPDATE workspace_group_bindings SET revoked_at = now() WHERE id = ${teamBinding}`;
      denied(yield* requireWorkspaceAccess(group).pipe(Effect.result));
      denied(
        yield* requireWorkspaceAccess({
          ...group,
          workspaceId: personal.workspaceId,
          groupBindingId: personalBinding,
        }).pipe(Effect.result)
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("SP02: an accepted invitation cannot be answered again by anyone", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor, guest, guestPersonal } = yield* workspaceFixture();
      const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`;
      yield* saveDirectoryProfile(guestPersonal, {
        username,
        discoverable: false,
      });
      const invitation = yield* inviteWorkspaceMember(actor, username);
      if (!invitation.id) throw new Error("Invitation ID missing");
      expect(
        yield* answerWorkspaceInvitation(guestPersonal, invitation.id, true)
      ).toEqual({ workspaceId: actor.workspaceId });
      denied(
        yield* answerWorkspaceInvitation(
          guestPersonal,
          invitation.id,
          true
        ).pipe(Effect.result)
      );
      denied(
        yield* answerWorkspaceInvitation(actor, invitation.id, true).pipe(
          Effect.result
        )
      );
      expect(
        yield* sql`SELECT count(*)::int AS memberships FROM workspace_memberships
          WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
      ).toEqual([{ memberships: 1 }]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("SP05: removal cancels the rendered report chunks a member had queued", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor, guest } = yield* workspaceFixture();
      const identity = yield* linkedIdentity(
        {
          channel: "telegram",
          installationId: `boundary-${randomUUID()}`,
          senderId: randomUUID(),
        },
        { userId: guest.userId.slice("better-auth:".length) }
      );
      const jobId = randomUUID();
      const runId = randomUUID();
      yield* sql`INSERT INTO scheduled_agent_jobs
        (id, workspace_id, created_by_user_id, conversation_channel, conversation_id, prompt, timing, status)
        VALUES (${jobId}, ${guest.workspaceId}, ${guest.userId}, 'telegram', ${identity.id}, 'Report task',
          '{"kind":"once","at":"2030-01-01T00:00:00Z"}'::jsonb, 'completed')`;
      yield* sql`INSERT INTO scheduled_agent_runs (id, job_id, scheduled_for, status, report_status, outcome)
        VALUES (${runId}, ${jobId}, clock_timestamp(), 'completed', 'pending',
          ${sql.json({ kind: "result", summary: "s".repeat(4000), details: "d".repeat(5000), urgency: "normal" })})`;
      yield* dispatchNativeScheduledReport(runId);
      const chunks = (identityId: string) =>
        sql<{
          status: string;
          lastError: string | null;
        }>`SELECT status, last_error AS "lastError" FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY sequence`;
      expect(yield* chunks(identity.id)).toEqual([
        { status: "queued", lastError: null },
        { status: "queued", lastError: null },
        { status: "queued", lastError: null },
      ]);
      yield* removeWorkspaceMember(actor, guest.userId);
      expect(yield* chunks(identity.id)).toEqual([
        { status: "cancelled", lastError: "member_removed" },
        { status: "cancelled", lastError: "member_removed" },
        { status: "cancelled", lastError: "member_removed" },
      ]);
      expect(
        yield* sql`SELECT run_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT metadata FROM organization_audit_receipts
          WHERE action = 'member_removed' AND target_user_id = ${guest.userId}
          ORDER BY created_at DESC LIMIT 1`
      ).toEqual([
        {
          metadata: {
            removedSessions: 0,
            removedJobs: 1,
            cancelledOutbox: 3,
            revokedGrants: 0,
            canceledTasks: 0,
          },
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(reportServices))
  ));
