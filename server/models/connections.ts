import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { DateTime, Effect, Result, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  ModelConnectionError,
  ModelProviderSchema,
  WorkspaceModelSchema,
  defaultWorkspaceModel,
  modelCatalog,
} from "../../shared/models/catalog";
import {
  beginModelOAuth,
  DevicePayloadSchema,
  ModelTokensSchema,
  pollModelOAuth,
  refreshModelOAuth,
} from "./oauth";
import { openModelSecret, sealModelSecret } from "./secrets";

const Connection = Schema.Struct({
  provider: ModelProviderSchema,
  model: WorkspaceModelSchema,
  revision: Schema.String,
  credentials: Schema.NullOr(Schema.String),
});
const Request = Schema.Struct({
  provider: ModelProviderSchema,
  payload: Schema.String,
  interval_seconds: Schema.Number,
  remaining: Schema.Number,
  wait: Schema.Number,
});
const decodeTokens = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ModelTokensSchema)
);

export const readModelConnection = Effect.fn("model.connection.read")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const access = yield* requireWorkspaceAccess(actor);
    const sql = yield* PgClient.PgClient;
    const rows =
      yield* sql`SELECT provider, model, revision, credentials IS NOT NULL AS connected FROM model_connections WHERE workspace_id = ${actor.workspaceId}`;
    const connections = yield* Schema.decodeUnknownEffect(
      Schema.Array(
        Schema.Struct({
          provider: ModelProviderSchema,
          model: WorkspaceModelSchema,
          revision: Schema.String,
          connected: Schema.Boolean,
        })
      )
    )(rows);
    return {
      connection: connections[0] ?? null,
      mayManage: access.role !== "member" && Boolean(actor.authSessionId),
      team: Boolean(access.organizationId),
    };
  }
);

export const startModelConnection = Effect.fn("model.connection.start")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    provider: typeof ModelProviderSchema.Type
  ) {
    if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
    const authSessionId = actor.authSessionId;
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5813))`;
        const recent =
          yield* sql`SELECT id FROM model_oauth_requests WHERE workspace_id = ${actor.workspaceId} AND created_at > now() - interval '1 hour'`;
        if (recent.length >= 8)
          return yield* new ModelConnectionError({ reason: "rate_limited" });
        const device = yield* beginModelOAuth(provider);
        const now = yield* DateTime.nowAsDate;
        const expiresAt = new Date(now.getTime() + device.expiresIn * 1000);
        const id = randomUUID();
        const payload = yield* sealModelSecret(
          actor.workspaceId,
          provider,
          JSON.stringify({
            deviceCode: device.deviceCode,
            userCode: device.userCode,
          })
        );
        // Starting another request invalidates older challenges in this workspace.
        yield* sql`UPDATE model_oauth_requests SET payload = '' WHERE workspace_id = ${actor.workspaceId}`;
        yield* sql`DELETE FROM model_oauth_requests WHERE workspace_id = ${actor.workspaceId} AND created_at < now() - interval '1 day'`;
        yield* sql`INSERT INTO model_oauth_requests(id, workspace_id, user_id, auth_session_id, provider, payload, interval_seconds, expires_at)
      VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${authSessionId}, ${provider}, ${payload}, ${device.interval}, ${expiresAt})`;
        return {
          id,
          userCode: device.userCode,
          verificationUri: device.verificationUri,
          expiresAt: expiresAt.toISOString(),
          interval: device.interval,
        };
      })
    );
  }
);

export const finishModelConnection = Effect.fn("model.connection.poll")(
  function* (actor: typeof WorkspaceActorSchema.Type, id: string) {
    if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5813))`;
        const rows =
          yield* sql`SELECT provider, payload, interval_seconds, extract(epoch from (expires_at - now()))::float8 AS remaining,
      extract(epoch from (next_poll_at - now()))::float8 AS wait FROM model_oauth_requests
      WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} AND auth_session_id = ${actor.authSessionId} FOR UPDATE`;
        if (rows.length !== 1)
          return yield* new ModelConnectionError({ reason: "expired" });
        const request = yield* Schema.decodeUnknownEffect(Request)(rows[0]);
        if (!request.payload || request.remaining <= 0)
          return yield* new ModelConnectionError({ reason: "expired" });
        if (request.wait > 0)
          return {
            status: "pending",
            interval: Math.ceil(request.wait),
          } as const;
        const plain = yield* openModelSecret(
          actor.workspaceId,
          request.provider,
          request.payload
        );
        const payload = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(DevicePayloadSchema)
        )(plain);
        const result = yield* pollModelOAuth(request.provider, payload).pipe(
          Effect.result
        );
        if (Result.isFailure(result)) {
          yield* sql`UPDATE model_oauth_requests SET payload = '' WHERE id = ${id}`;
          return { status: "failed" } as const;
        }
        if (result.success.status !== "connected") {
          const interval = Math.min(
            60,
            request.interval_seconds +
              (result.success.status === "slow_down" ? 5 : 0)
          );
          yield* sql`UPDATE model_oauth_requests SET interval_seconds = ${interval}, next_poll_at = now() + ${interval} * interval '1 second' WHERE id = ${id}`;
          return { status: "pending", interval } as const;
        }
        const credentials = yield* sealModelSecret(
          actor.workspaceId,
          request.provider,
          JSON.stringify(result.success.tokens)
        );
        yield* sql`INSERT INTO model_connections(workspace_id, provider, model, credentials, connected_by)
      VALUES (${actor.workspaceId}, ${request.provider}, ${defaultWorkspaceModel[request.provider]}, ${credentials}, ${actor.userId})
      ON CONFLICT (workspace_id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model, credentials = EXCLUDED.credentials,
        connected_by = EXCLUDED.connected_by, revision = ${randomUUID()}, updated_at = now()`;
        yield* sql`UPDATE model_oauth_requests SET payload = '' WHERE id = ${id}`;
        return { status: "connected" } as const;
      })
    );
  }
);

export const selectWorkspaceModel = Effect.fn("model.connection.select")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    model: typeof WorkspaceModelSchema.Type
  ) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
        const rows =
          yield* sql`UPDATE model_connections SET model = ${model}, revision = ${randomUUID()}, updated_at = now()
      WHERE workspace_id = ${actor.workspaceId} AND provider = ${modelCatalog[model].provider} AND credentials IS NOT NULL RETURNING workspace_id`;
        if (rows.length !== 1)
          return yield* new ModelConnectionError({ reason: "changed" });
        return undefined;
      })
    );
  }
);

export const disconnectModel = Effect.fn("model.connection.disconnect")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5813))`;
        yield* sql`UPDATE model_oauth_requests SET payload = '' WHERE workspace_id = ${actor.workspaceId}`;
        yield* sql`UPDATE model_connections SET credentials = NULL, revision = ${randomUUID()}, updated_at = now() WHERE workspace_id = ${actor.workspaceId}`;
        return undefined;
      })
    );
  }
);

/** Refresh under a database row lock: replicas never race a rotating refresh token. */
export const modelCredentials = Effect.fn("model.connection.credentials")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    expectedRevision?: string
  ) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor);
        const rows =
          yield* sql`SELECT provider, model, revision, credentials FROM model_connections WHERE workspace_id = ${actor.workspaceId} FOR UPDATE`;
        if (rows.length === 0) {
          if (expectedRevision)
            return yield* new ModelConnectionError({ reason: "changed" });
          return null;
        }
        const connection = yield* Schema.decodeUnknownEffect(Connection)(
          rows[0]
        );
        if (
          expectedRevision &&
          (connection.revision !== expectedRevision || !connection.credentials)
        )
          return yield* new ModelConnectionError({ reason: "changed" });
        if (!connection.credentials) return null;
        const plain = yield* openModelSecret(
          actor.workspaceId,
          connection.provider,
          connection.credentials
        );
        let tokens = yield* decodeTokens(plain);
        const now = yield* DateTime.nowAsDate;
        if (tokens.expiresAt < now.getTime() + 300_000) {
          tokens = yield* refreshModelOAuth(connection.provider, tokens);
          const encrypted = yield* sealModelSecret(
            actor.workspaceId,
            connection.provider,
            JSON.stringify(tokens)
          );
          yield* sql`UPDATE model_connections SET credentials = ${encrypted}, updated_at = now() WHERE workspace_id = ${actor.workspaceId}`;
        }
        return {
          provider: connection.provider,
          model: connection.model,
          revision: connection.revision,
          tokens,
        };
      })
    );
  }
);
