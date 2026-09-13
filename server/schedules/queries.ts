import { scheduledConversationChannelSchema } from "../../shared/schedules/conversation";
import { scheduledReportStatusSchema } from "../../shared/schedules/report-status";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type { AccessScope } from "../../shared/identity/access-scope";

const reminderSchema = Schema.Struct({
  id: Schema.String,
  revision: Schema.Int,
  mayManage: Schema.Boolean,
  prompt: Schema.String,
  status: Schema.Literals(["active", "paused", "completed"]),
  nextRunAt: Schema.NullOr(Schema.Date),
  conversationChannel: scheduledConversationChannelSchema,
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
  latestReportStatus: Schema.NullOr(scheduledReportStatusSchema),
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
      SELECT j.id, j.revision, (viewer.role IN ('owner', 'admin') OR j.created_by_user_id = ${scope.userId}) AS "mayManage",
        j.prompt, j.status, j.next_run_at AS "nextRunAt",
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
      INNER JOIN workspace_memberships viewer ON viewer.workspace_id = j.workspace_id AND viewer.user_id = ${scope.userId}
      INNER JOIN workspaces w ON w.id = j.workspace_id
      LEFT JOIN LATERAL (
        SELECT status, report_status, scheduled_for
        FROM scheduled_agent_runs WHERE job_id = j.id
        ORDER BY scheduled_for DESC, id DESC LIMIT 1
      ) r ON TRUE
      WHERE j.workspace_id = ${scope.workspaceId}
        AND (j.created_by_user_id = ${scope.userId} OR w.organization_id IS NOT NULL)
        AND (w.organization_id IS NULL OR (
          EXISTS (SELECT 1 FROM organization_memberships o WHERE o.organization_id = w.organization_id AND o.user_id = ${scope.userId})
          AND EXISTS (SELECT 1 FROM organization_memberships o WHERE o.organization_id = w.organization_id AND o.user_id = j.created_by_user_id)
        ))
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
