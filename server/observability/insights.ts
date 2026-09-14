import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { env } from "@shared/environment";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import {
  openDiagnosticPayload,
  readTelemetryPolicy,
  recordTelemetry,
} from "./events";

const EventRow = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  user_id: Schema.NullOr(Schema.String),
  workspace_id: Schema.NullOr(Schema.String),
  session_id: Schema.NullOr(Schema.String),
  turn_id: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  created_at: Schema.Date,
  metadata: Schema.Json,
  payload: Schema.NullOr(Schema.String),
});

const isTelemetryOperator = Effect.fn("telemetry.operator")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  if (!actor.authSessionId || env.ZOEN_OPERATOR_EMAILS.length === 0)
    return false;
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT email FROM public."user" WHERE ('better-auth:' || id) = ${actor.userId} AND "emailVerified" = true`;
  const users = yield* Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({ email: Schema.String }))
  )(rows);
  return Boolean(
    users[0] && env.ZOEN_OPERATOR_EMAILS.includes(users[0].email.toLowerCase())
  );
});

export const readInsights = Effect.fn("telemetry.insights")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  platform = false
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const access = yield* requireWorkspaceAccess(actor);
      if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
      const operator = yield* isTelemetryOperator(actor);
      if (platform && !operator) return yield* new WorkspaceAccessDenied();
      const visible = platform
        ? sql`TRUE`
        : sql`workspace_id = ${actor.workspaceId} AND (${access.role !== "member"} OR user_id = ${actor.userId})`;
      const totals =
        yield* sql`SELECT count(*) FILTER (WHERE kind = 'turn.completed')::int AS turns,
      count(*) FILTER (WHERE kind = 'turn.failed')::int AS failures,
      count(*) FILTER (WHERE kind = 'action.result' AND status = 'failed')::int AS tool_failures,
      count(*) FILTER (WHERE kind = 'client.error')::int AS client_errors,
      count(*) FILTER (WHERE kind = 'server.error')::int AS server_errors,
      coalesce(sum(input_tokens), 0)::float8 AS input_tokens, coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
      sum(cost_usd)::float8 AS cost_usd,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE kind = 'step.completed')::float8 AS p95_ms
      FROM telemetry_events WHERE ${visible} AND created_at > now() - interval '7 days'`;
      const summary = yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            turns: Schema.Number,
            failures: Schema.Number,
            tool_failures: Schema.Number,
            client_errors: Schema.Number,
            server_errors: Schema.Number,
            input_tokens: Schema.Number,
            output_tokens: Schema.Number,
            cost_usd: Schema.NullOr(Schema.Number),
            p95_ms: Schema.NullOr(Schema.Number),
          })
        )
      )(totals);
      const activity =
        yield* sql`SELECT e.session_id, min(e.workspace_id) AS workspace_id, min(e.user_id) AS user_id,
      max(e.created_at) AS last_at, count(*)::int AS events, bool_or(e.status = 'failed') AS failed,
      count(*) FILTER (WHERE e.kind = 'feedback')::int AS feedback, max(r.status) AS review_status
      FROM telemetry_events e LEFT JOIN telemetry_reviews r ON r.session_id = e.session_id
      WHERE ${visible} AND e.created_at > now() - interval '7 days' AND e.session_id IS NOT NULL
      GROUP BY e.session_id ORDER BY max(e.created_at) DESC LIMIT 60`;
      const sessions = yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            session_id: Schema.String,
            workspace_id: Schema.NullOr(Schema.String),
            user_id: Schema.NullOr(Schema.String),
            last_at: Schema.Date,
            events: Schema.Number,
            failed: Schema.NullOr(Schema.Boolean),
            feedback: Schema.Number,
            review_status: Schema.NullOr(Schema.String),
          })
        )
      )(activity);
      return {
        summary: summary[0],
        sessions,
        operator,
        mayManage: access.role !== "member",
        policy: yield* readTelemetryPolicy(actor.workspaceId),
      };
    })
  );
});

export const readDiagnosticSession = Effect.fn("telemetry.session.read")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    sessionId: string,
    platform = false,
    cursor: string | null = null
  ) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const access = yield* requireWorkspaceAccess(actor);
        if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
        if (platform && !(yield* isTelemetryOperator(actor)))
          return yield* new WorkspaceAccessDenied();
        const visible = sql`(${platform} OR (workspace_id = ${actor.workspaceId} AND (${access.role !== "member"} OR user_id = ${actor.userId})))`;
        // Keyset pagination keeps large replays bounded and stable when timestamps are identical.
        const rows = yield* sql`WITH candidates AS (
          SELECT id, kind, user_id, workspace_id, session_id, turn_id, status, name, model, created_at, metadata, payload
          FROM telemetry_events WHERE session_id = ${sessionId} AND ${visible}
            AND (${cursor}::text IS NULL OR (created_at, id) > (
              SELECT created_at, id FROM telemetry_events WHERE id = ${cursor} AND session_id = ${sessionId} AND ${visible}
            )) ORDER BY created_at, id LIMIT 51
        ), bounded AS (
          SELECT *, row_number() OVER (ORDER BY created_at, id) AS position,
            sum(coalesce(octet_length(payload), 0) + octet_length(metadata::text)) OVER (ORDER BY created_at, id) AS bytes,
            lead(id) OVER (ORDER BY created_at, id) IS NOT NULL AS more
          FROM candidates
        ) SELECT * FROM bounded WHERE (bytes <= 2000000 OR position = 1) AND position <= 50 ORDER BY created_at, id`;
        const page = yield* Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ ...EventRow.fields, more: Schema.Boolean })
          )
        )(rows);
        if (!page.length && !cursor) return yield* new WorkspaceAccessDenied();
        const policies = new Map<string, boolean>();
        for (const event of page) {
          if (event.workspace_id && !policies.has(event.workspace_id))
            policies.set(
              event.workspace_id,
              (yield* readTelemetryPolicy(event.workspace_id)).captureContent
            );
        }
        const result = yield* Effect.forEach(
          page,
          ({ more: _more, ...event }) =>
            Effect.gen(function* () {
              // A workspace can stop sharing diagnostic content without deleting its operational metrics.
              const allowed = event.workspace_id
                ? (policies.get(event.workspace_id) ?? false)
                : Boolean(platform && env.ZOEN_BETA_FULL_TELEMETRY);
              const payload =
                allowed && event.payload
                  ? yield* openDiagnosticPayload(event.payload)
                  : null;
              return {
                ...event,
                metadata: JSON.stringify(event.metadata),
                payload: payload === null ? null : JSON.stringify(payload),
              };
            }),
          { concurrency: 5 }
        );
        if (platform)
          yield* recordTelemetry({
            id: randomUUID(),
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            kind: "telemetry.operator.read",
            metadata: { sessionId },
          });
        const last = page.at(-1);
        return { events: result, nextCursor: last?.more ? last.id : null };
      })
    );
  }
);

export const reviewDiagnostic = Effect.fn("telemetry.review")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  sessionId: string,
  status: "new" | "investigating" | "resolved" | "eval-candidate"
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor);
      if (!actor.authSessionId || !(yield* isTelemetryOperator(actor)))
        return yield* new WorkspaceAccessDenied();
      const rows =
        yield* sql`SELECT id FROM telemetry_events WHERE session_id = ${sessionId} LIMIT 1`;
      if (!rows.length) return yield* new WorkspaceAccessDenied();
      yield* sql`INSERT INTO telemetry_reviews(session_id, status, reviewed_by) VALUES (${sessionId}, ${status}, ${actor.userId})
      ON CONFLICT (session_id) DO UPDATE SET status = EXCLUDED.status, reviewed_by = EXCLUDED.reviewed_by, updated_at = now()`;
      yield* recordTelemetry({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        kind: "telemetry.operator.review",
        metadata: { sessionId, status },
      });
      return undefined;
    })
  );
});
