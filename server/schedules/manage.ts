import { PgClient } from "@effect/sql-pg";
import { DateTime, Effect, Schema } from "effect";
import {
  computeNextRun,
  scheduleTimingSchema,
} from "../../shared/schedules/timing";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export const ReminderStatusSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  status: Schema.Literals(["active", "paused"]),
});
class ScheduleChanged extends Schema.TaggedError<ScheduleChanged>()(
  "ScheduleChanged",
  {}
) {}

export const setReminderStatus = Effect.fn("setReminderStatus")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof ReminderStatusSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(ReminderStatusSchema)(raw);
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const access = yield* requireWorkspaceAccess(actor);
      if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
      const jobs = yield* sql<{
        owner: string;
        revision: number;
        timing: unknown;
      }>`SELECT created_by_user_id AS owner, revision, timing
      FROM scheduled_agent_jobs WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND status <> 'deleted' FOR UPDATE`;
      const job = jobs[0];
      if (!job || (job.owner !== actor.userId && access.role === "member"))
        return yield* new WorkspaceAccessDenied();
      if (job.revision !== input.revision) return yield* new ScheduleChanged();
      const now = DateTime.toDateUtc(yield* DateTime.now);
      const timing = yield* Effect.try({
        try: () => scheduleTimingSchema.parse(job.timing),
        catch: () => new ScheduleChanged(),
      });
      const nextRunAt =
        input.status === "active" ? computeNextRun(timing, now) : null;
      if (input.status === "active" && !nextRunAt)
        return yield* new ScheduleChanged();
      yield* sql`UPDATE scheduled_agent_jobs SET status = ${input.status}, next_run_at = ${nextRunAt},
      revision = revision + 1, updated_at = ${now} WHERE id = ${input.id}`;
      return { status: input.status, nextRunAt, revision: job.revision + 1 };
    })
  );
});
