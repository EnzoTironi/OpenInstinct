import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type { AccessScope } from "../../shared/identity/access-scope";

const reminderSchema = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  status: Schema.Literals(["active", "paused", "completed"]),
  nextRunAt: Schema.NullOr(Schema.Date),
  conversationChannel: Schema.Literals(["eve", "linq"]),
  originalSessionId: Schema.NullOr(Schema.String),
  latestRunStatus: Schema.NullOr(
    Schema.Literals([
      "queued",
      "running",
      "waiting_for_input",
      "completed",
      "dead_letter",
    ])
  ),
  latestReportStatus: Schema.NullOr(
    Schema.Literals([
      "not_ready",
      "not_needed",
      "pending",
      "queued",
      "delivered",
      "suppressed",
    ])
  ),
  latestScheduledFor: Schema.NullOr(Schema.Date),
});
const decodeReminders = Schema.decodeUnknownEffect(
  Schema.Array(reminderSchema)
);

class RemindersUnavailable extends Schema.TaggedError<RemindersUnavailable>()(
  "RemindersUnavailable",
  {}
) {}

export const listReminders = Effect.fn("listReminders")(
  function* (scope: AccessScope) {
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql`
      SELECT j.id, j.prompt, j.status, j.next_run_at AS "nextRunAt",
        j.conversation_channel AS "conversationChannel",
        CASE WHEN j.conversation_channel = 'eve' AND EXISTS (
          SELECT 1 FROM agent_sessions s
          WHERE s.session_id = j.conversation_id
            AND s.workspace_id = ${scope.workspaceId}
            AND s.created_by_user_id = ${scope.userId}
        ) THEN j.conversation_id ELSE NULL END AS "originalSessionId",
        r.status AS "latestRunStatus", r.report_status AS "latestReportStatus",
        r.scheduled_for AS "latestScheduledFor"
      FROM scheduled_agent_jobs j
      INNER JOIN workspace_memberships m
        ON m.workspace_id = j.workspace_id AND m.user_id = j.created_by_user_id
      LEFT JOIN LATERAL (
        SELECT status, report_status, scheduled_for
        FROM scheduled_agent_runs WHERE job_id = j.id
        ORDER BY scheduled_for DESC, id DESC LIMIT 1
      ) r ON TRUE
      WHERE j.workspace_id = ${scope.workspaceId}
        AND j.created_by_user_id = ${scope.userId}
        AND j.status IN ('active', 'paused', 'completed')
      ORDER BY CASE j.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
        j.next_run_at ASC NULLS LAST, j.updated_at DESC, j.id ASC
      LIMIT 51`;
    const reminders = yield* decodeReminders(rows);
    return {
      reminders: reminders.slice(0, 50),
      hasMore: reminders.length > 50,
    };
  },
  Effect.catchTag(["SqlError", "SchemaError"], () => new RemindersUnavailable())
);
