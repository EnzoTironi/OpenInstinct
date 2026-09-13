import { randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import { listReminders } from "../../server/schedules/queries";
import { setReminderStatus } from "../../server/schedules/manage";
import { requireWorkspaceAccess } from "../../server/workspaces/access";
import { requireBrowserWorkerScheduleActive } from "../../server/browser-worker/access";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);

test("team schedules are visible together, editable by owners/admins, and isolated from personal work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, sql } = yield* workspaceFixture();
      const ownerJob = randomUUID();
      const memberJob = randomUUID();
      const privateJob = randomUUID();
      for (const [id, owner] of [
        [ownerJob, actor],
        [memberJob, guest],
        [privateJob, personal],
      ] as const) {
        yield* sql`INSERT INTO scheduled_agent_jobs(id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, next_run_at)
        VALUES (${id}, ${owner.workspaceId}, ${owner.userId}, 'Synthetic schedule', 'eve', ${randomUUID()}, '{"kind":"once","at":"2030-01-01T12:00:00Z"}', '2030-01-01T12:00:00Z')`;
      }
      const page = yield* listReminders(guest);
      expect(new Set(page.reminders.map((job) => job.id))).toEqual(
        new Set([ownerJob, memberJob])
      );
      expect(page.reminders.find((job) => job.id === ownerJob)?.mayManage).toBe(
        false
      );
      expect(
        Result.isFailure(
          yield* setReminderStatus(guest, {
            id: ownerJob,
            revision: 0,
            status: "paused",
          }).pipe(Effect.result)
        )
      ).toBe(true);
      expect(
        Result.isFailure(
          yield* setReminderStatus(actor, {
            id: privateJob,
            revision: 0,
            status: "paused",
          }).pipe(Effect.result)
        )
      ).toBe(true);
      const paused = yield* setReminderStatus(actor, {
        id: memberJob,
        revision: 0,
        status: "paused",
      });
      expect(paused.status).toBe("paused");
      expect(
        Result.isFailure(
          yield* setReminderStatus(guest, {
            id: memberJob,
            revision: 0,
            status: "active",
          }).pipe(Effect.result)
        )
      ).toBe(true);
      expect(
        (yield* setReminderStatus(guest, {
          id: memberJob,
          revision: paused.revision,
          status: "active",
        })).nextRunAt?.toISOString()
      ).toBe("2030-01-01T12:00:00.000Z");
      yield* sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`;
      expect((yield* listReminders(guest)).reminders).toEqual([]);
      expect(
        Result.isFailure(
          yield* setReminderStatus(guest, {
            id: memberJob,
            revision: 2,
            status: "paused",
          }).pipe(Effect.result)
        )
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("a materialized one-shot job runs with its live lease, while pause, lease expiry and removal deny tools", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, sql } = yield* workspaceFixture();
      const id = randomUUID();
      const run = randomUUID();
      const lease = randomUUID();
      yield* sql`INSERT INTO scheduled_agent_jobs(id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, status)
      VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, 'Synthetic one-shot', 'eve', ${randomUUID()}, '{"kind":"once","at":"2026-01-01T12:00:00Z"}', 'completed')`;
      yield* sql`INSERT INTO scheduled_agent_runs(id, job_id, scheduled_for, status, lease_token, lease_expires_at)
      VALUES (${run}, ${id}, now(), 'running', ${lease}, now() + interval '5 minutes')`;
      const worker = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        scheduledRunId: run,
        scheduledRunLeaseToken: lease,
      };
      yield* requireWorkspaceAccess(worker);
      yield* requireBrowserWorkerScheduleActive(actor, id);
      yield* sql`UPDATE scheduled_agent_jobs SET status = 'paused' WHERE id = ${id}`;
      expect(
        Result.isFailure(
          yield* requireWorkspaceAccess(worker).pipe(Effect.result)
        )
      ).toBe(true);
      yield* sql`UPDATE scheduled_agent_jobs SET status = 'completed' WHERE id = ${id}`;
      yield* sql`UPDATE scheduled_agent_runs SET lease_expires_at = now() - interval '1 second' WHERE id = ${run}`;
      expect(
        Result.isFailure(
          yield* requireWorkspaceAccess(worker).pipe(Effect.result)
        )
      ).toBe(true);
      yield* sql`UPDATE scheduled_agent_runs SET lease_expires_at = now() + interval '5 minutes' WHERE id = ${run}`;
      yield* sql`DELETE FROM organization_memberships WHERE user_id = ${actor.userId}`;
      expect(
        Result.isFailure(
          yield* requireWorkspaceAccess(worker).pipe(Effect.result)
        )
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
