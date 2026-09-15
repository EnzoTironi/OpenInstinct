import { randomUUID } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { authentication } from "@db/services/auth";
import { env } from "@shared/environment";
import { parseDiagnostic } from "../../shared/observability/redaction";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
  WorkspaceAccessDenied,
} from "../workspaces/access";

const TelemetryEventSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  workspaceId: Schema.optional(Schema.String),
  userId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  turnId: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number),
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  costUsd: Schema.optional(Schema.Number),
  roomId: Schema.optional(Schema.String),
  toolPath: Schema.optional(Schema.String),
  grantId: Schema.optional(Schema.String),
  outboxId: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Json),
  payload: Schema.optional(Schema.Unknown),
});

const JsonRecord = Schema.Record(Schema.String, Schema.Json);

function correlationMetadata(event: typeof TelemetryEventSchema.Type) {
  return parseDiagnostic(
    JSON.stringify(
      Object.assign(
        Schema.is(JsonRecord)(event.metadata) ? event.metadata : {},
        {
          grantId: event.grantId ?? null,
          outboxId: event.outboxId ?? null,
          roomId: event.roomId ?? null,
          toolPath: event.toolPath ?? null,
        }
      )
    )
  );
}

export const readTelemetryPolicy = Effect.fn("telemetry.policy")(function* (
  workspaceId: string
) {
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT capture_content, retention_days FROM telemetry_settings WHERE workspace_id = ${workspaceId}`;
  const policy = yield* Schema.decodeUnknownEffect(
    Schema.Array(
      Schema.Struct({
        capture_content: Schema.Boolean,
        retention_days: Schema.Number,
      })
    )
  )(rows);
  return {
    captureContent:
      env.ZOEN_BETA_FULL_TELEMETRY && (policy[0]?.capture_content ?? true),
    retentionDays: policy[0]?.retention_days ?? 14,
  };
});

export const recordTelemetry = Effect.fn("telemetry.record")(function* (
  event: typeof TelemetryEventSchema.Type
) {
  const sql = yield* PgClient.PgClient;
  let payload: string | null = null;
  if (
    event.payload !== undefined &&
    (event.workspaceId
      ? (yield* readTelemetryPolicy(event.workspaceId)).captureContent
      : env.ZOEN_BETA_FULL_TELEMETRY)
  ) {
    const auth = yield* authentication;
    const safe = parseDiagnostic(JSON.stringify(event.payload));
    payload = yield* Effect.promise(async () =>
      symmetricEncrypt({
        key: (await auth.$context).secretConfig,
        data: JSON.stringify(safe),
      })
    );
  }
  yield* sql`INSERT INTO telemetry_events(id, workspace_id, user_id, session_id, turn_id, kind, channel, model, name, status,
    duration_ms, input_tokens, output_tokens, cost_usd, metadata, payload)
    VALUES (${event.id}, ${event.workspaceId ?? null}, ${event.userId ?? null}, ${event.sessionId ?? null}, ${event.turnId ?? null}, ${event.kind},
      ${event.channel ?? null}, ${event.model ?? null}, ${event.name ?? null}, ${event.status ?? null}, ${event.durationMs ?? null},
      ${event.inputTokens ?? null}, ${event.outputTokens ?? null}, ${event.costUsd ?? null}, ${sql.json(correlationMetadata(event))}, ${payload})
    ON CONFLICT (id) DO NOTHING`;
});

export const openDiagnosticPayload = Effect.fn("telemetry.payload")(function* (
  payload: string
) {
  const auth = yield* authentication;
  const text = yield* Effect.promise(async () =>
    symmetricDecrypt({ key: (await auth.$context).secretConfig, data: payload })
  );
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
    text
  );
});

export const ClientBatchSchema = Schema.Struct({
  recordingId: Schema.String.check(Schema.isUUID()),
  batchId: Schema.String.check(Schema.isUUID()),
  kind: Schema.Literals([
    "replay",
    "client.error",
    "client.performance",
    "feedback",
  ]),
  route: Schema.String.check(Schema.isMaxLength(200)),
  sessionId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  data: Schema.String.check(Schema.isMaxLength(1_000_000)),
});

export const ingestClientTelemetry = Effect.fn("telemetry.client")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  batch: typeof ClientBatchSchema.Type
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor);
      if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
      if (
        !(yield* readTelemetryPolicy(actor.workspaceId)).captureContent &&
        batch.kind === "replay"
      )
        return undefined;
      // Never accept a client-supplied session belonging to another person or workspace.
      if (batch.sessionId) {
        const sessions =
          yield* sql`SELECT session_id FROM agent_sessions WHERE session_id = ${batch.sessionId} AND workspace_id = ${actor.workspaceId} AND created_by_user_id = ${actor.userId}`;
        if (sessions.length !== 1) return yield* new WorkspaceAccessDenied();
      }
      yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.userId}, 5814))`;
      const recent =
        yield* sql`SELECT id FROM telemetry_events WHERE user_id = ${actor.userId} AND kind IN ('replay', 'client.error', 'client.performance', 'feedback') AND created_at > now() - interval '1 minute' LIMIT 61`;
      if (recent.length >= 60) return undefined;
      const content = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Json)
      )(batch.data);
      yield* recordTelemetry({
        id: `client:${actor.userId}:${batch.batchId}`,
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        sessionId: batch.sessionId ?? `replay:${batch.recordingId}`,
        kind: batch.kind,
        status: batch.kind === "client.error" ? "failed" : "completed",
        name: batch.route.split("?")[0],
        metadata: {
          recordingId: batch.recordingId,
          route: batch.route.split("?")[0] ?? "/",
        },
        payload: content,
      });
      return undefined;
    })
  );
});

export const updateTelemetryPolicy = Effect.fn("telemetry.policy.update")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    captureContent: boolean,
    retentionDays: 7 | 14 | 30
  ) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
        yield* sql`INSERT INTO telemetry_settings(workspace_id, capture_content, retention_days) VALUES (${actor.workspaceId}, ${captureContent}, ${retentionDays})
      ON CONFLICT (workspace_id) DO UPDATE SET capture_content = EXCLUDED.capture_content, retention_days = EXCLUDED.retention_days`;
        yield* recordTelemetry({
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          kind: "telemetry.policy.changed",
          metadata: { captureContent, retentionDays },
        });
        return undefined;
      })
    );
  }
);

export const pruneTelemetry = Effect.fn("telemetry.retention")(function* () {
  const sql = yield* PgClient.PgClient;
  yield* sql`UPDATE telemetry_events e SET payload = NULL WHERE e.payload IS NOT NULL AND e.created_at < now() -
    coalesce((SELECT retention_days FROM telemetry_settings s WHERE s.workspace_id = e.workspace_id), 14) * interval '1 day'`;
  yield* sql`DELETE FROM telemetry_events WHERE created_at < now() - interval '90 days'`;
  yield* sql`DELETE FROM telemetry_reviews r WHERE NOT EXISTS (SELECT 1 FROM telemetry_events e WHERE e.session_id = r.session_id)`;
  yield* sql`DELETE FROM model_oauth_requests WHERE created_at < now() - interval '1 day'`;
});
