import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import { expect, test } from "vitest";

import { listReminders } from "../../server/schedules/queries";
import type { AccessScope } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const fixture = Effect.fn("reminders.fixture")(function* (
  body: (
    scopes: Readonly<Record<"owner" | "neighbor" | "elsewhere", AccessScope>>
  ) => Effect.Effect<void, unknown, PgClient.PgClient>
) {
  const sql = yield* PgClient.PgClient;
  const prefix = `reminders-test-${randomUUID()}`;
  const owner = { workspaceId: prefix, userId: `${prefix}-owner` };
  const neighbor = { workspaceId: prefix, userId: `${prefix}-neighbor` };

  const elsewhere = {
    workspaceId: `${prefix}-elsewhere`,
    userId: owner.userId,
  };

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`INSERT INTO workspaces (id) VALUES (${owner.workspaceId}), (${elsewhere.workspaceId})`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
      (${owner.workspaceId}, ${owner.userId}, 'owner'),
      (${neighbor.workspaceId}, ${neighbor.userId}, 'owner'),
      (${elsewhere.workspaceId}, ${elsewhere.userId}, 'owner')`;
      yield* body({ owner, neighbor, elsewhere });
      yield* sql`DELETE FROM workspaces WHERE id IN (${owner.workspaceId}, ${elsewhere.workspaceId})`;
    })
  );
});

const run = (body: Parameters<typeof fixture>[0]) =>
  Effect.runPromise(fixture(body).pipe(Effect.provide(runtimeDatabase)));

const insertJob = Effect.fn("reminders.insertFixtureJob")(function* (
  scope: AccessScope,
  conversationId: string,
  status: "active" | "paused" | "completed" | "deleted" = "active",
  channel: "eve" | "linq" = "eve"
) {
  const sql = yield* PgClient.PgClient;
  const id = randomUUID();
  yield* sql`INSERT INTO scheduled_agent_jobs
    (id, workspace_id, created_by_user_id, conversation_id, conversation_channel, prompt, timing, status, next_run_at, updated_at)
    VALUES (${id}, ${scope.workspaceId}, ${scope.userId}, ${conversationId}, ${channel}, 'Remember the appointment',
      '{"kind":"once","at":"2030-01-01T12:00:00Z"}'::jsonb, ${status},
      CASE WHEN ${status} = 'completed' THEN NULL ELSE '2030-01-01T12:00:00Z'::timestamptz END,
      '2029-01-01T00:00:00Z'::timestamptz)`;

  return id;
});

test("lists across conversations, isolates both owner dimensions and keeps run/report state separate", () =>
  run(({ owner, neighbor, elsewhere }) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      expect(yield* listReminders(owner)).toEqual({
        reminders: [],
        hasMore: false,
      });
      const active = yield* insertJob(owner, "original-a");
      const paused = yield* insertJob(owner, "original-paused", "paused");
      const completed = yield* insertJob(owner, "original-b", "completed");
      yield* insertJob(neighbor, "another-owner");
      yield* insertJob(elsewhere, "another-workspace");
      yield* insertJob(owner, "deleted", "deleted");
      yield* sql`INSERT INTO scheduled_agent_runs (job_id, scheduled_for, status, report_status)
    VALUES (${completed}, '2030-01-01T12:00:00Z', 'running', 'not_ready')`;
      const page = yield* listReminders(owner);
      expect(page.reminders.map((job) => job.id)).toEqual([
        active,
        paused,
        completed,
      ]);
      expect(page.reminders[0]?.nextRunAt?.toISOString()).toBe(
        "2030-01-01T12:00:00.000Z"
      );
      expect(page.reminders[2]).toMatchObject({
        status: "completed",
        nextRunAt: null,
        latestRunStatus: "running",
        latestReportStatus: "not_ready",
      });
      yield* sql`INSERT INTO scheduled_agent_runs (job_id, scheduled_for, status, report_status)
    VALUES (${completed}, '2030-01-02T12:00:00Z', 'completed', 'pending')`;
      expect((yield* listReminders(owner)).reminders[2]).toMatchObject({
        latestRunStatus: "completed",
        latestReportStatus: "pending",
      });
    })
  ));

test("links only a currently owned original Eve session and drops the link after revocation", () =>
  run(({ owner, neighbor }) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const original = randomUUID();
      const foreign = randomUUID();
      const ownedId = yield* insertJob(owner, original);
      const foreignId = yield* insertJob(owner, foreign);

      const linqId = yield* insertJob(
        owner,
        `linq:${original}`,
        "active",
        "linq"
      );

      yield* sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES
    (${original}, ${owner.workspaceId}, ${owner.userId}),
    (${foreign}, ${neighbor.workspaceId}, ${neighbor.userId}),
    (${`linq:${original}`}, ${owner.workspaceId}, ${owner.userId})`;
      const page = yield* listReminders(owner);
      expect(
        page.reminders.find((job) => job.id === ownedId)?.originalSessionId
      ).toBe(original);
      expect(
        page.reminders.find((job) => job.id === foreignId)?.originalSessionId
      ).toBeNull();
      expect(page.reminders.find((job) => job.id === linqId)).toMatchObject({
        conversationChannel: "linq",
        originalSessionId: null,
      });
      yield* sql`DELETE FROM agent_sessions WHERE session_id = ${original}`;
      expect(
        (yield* listReminders(owner)).reminders.find(
          (job) => job.id === ownedId
        )?.originalSessionId
      ).toBeNull();
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${owner.workspaceId} AND user_id = ${owner.userId}`;
      expect(yield* listReminders(owner)).toEqual({
        reminders: [],
        hasMore: false,
      });
    })
  ));

test("caps at 50 with stable ordering and an honest more-results flag", () =>
  run(({ owner }) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`INSERT INTO scheduled_agent_jobs
    (workspace_id, created_by_user_id, conversation_id, conversation_channel, prompt, timing, status, next_run_at, updated_at)
    SELECT ${owner.workspaceId}, ${owner.userId}, 'conversation-' || n, 'eve', 'Reminder ' || n,
      '{"kind":"once","at":"2030-01-01T12:00:00Z"}'::jsonb, 'active',
      '2030-01-01T12:00:00Z'::timestamptz, '2029-01-01T00:00:00Z'::timestamptz
    FROM generate_series(1, 51) AS n`;
      const page = yield* listReminders(owner);
      expect(page.hasMore).toBe(true);
      expect(page.reminders).toHaveLength(50);
      expect(page.reminders.map((job) => job.id)).toEqual(
        page.reminders.map((job) => job.id).toSorted()
      );
      expect(yield* listReminders(owner)).toEqual(page);
      yield* sql`DELETE FROM scheduled_agent_jobs WHERE id = ${page.reminders[0]?.id}`;
      const exactlyFifty = yield* listReminders(owner);
      expect(exactlyFifty.reminders).toHaveLength(50);
      expect(exactlyFifty.hasMore).toBe(false);
    })
  ));
