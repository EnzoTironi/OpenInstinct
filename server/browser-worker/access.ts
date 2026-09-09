import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type { AccessScope } from "../../shared/identity/access-scope";

export class BrowserWorkerAccessError extends Schema.TaggedError<BrowserWorkerAccessError>()(
  "BrowserWorkerAccessError",
  {
    reason: Schema.Literals([
      "unauthenticated",
      "revoked",
      "paused",
      "lease_inactive",
      "unavailable",
    ]),
  }
) {}

export const requireBrowserWorkerMembership = Effect.fn(
  "requireBrowserWorkerMembership"
)(function* (scope: AccessScope) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT workspace_id FROM workspace_memberships
    WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId} FOR SHARE`;
  if (rows.length !== 1)
    return yield* new BrowserWorkerAccessError({ reason: "unauthenticated" });
  return scope;
});

export const requireBrowserWorkerWebSession = Effect.fn(
  "requireBrowserWorkerWebSession"
)(function* (scope: AccessScope, sessionId: string) {
  yield* requireBrowserWorkerMembership(scope);
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT id FROM public.session
    WHERE id = ${sessionId} AND ('better-auth:' || "userId") = ${scope.userId}
      AND "expiresAt" > clock_timestamp() FOR SHARE`;
  if (rows.length !== 1)
    return yield* new BrowserWorkerAccessError({ reason: "unauthenticated" });
  return scope;
});

export const requireBrowserWorkerChannelIdentity = Effect.fn(
  "requireBrowserWorkerChannelIdentity"
)(function* (scope: AccessScope, identityId: string) {
  yield* requireBrowserWorkerMembership(scope);
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT id FROM channel_identity
    WHERE id = ${identityId} AND revoked_at IS NULL
      AND ('better-auth:' || user_id) = ${scope.userId} FOR SHARE`;
  if (rows.length !== 1)
    return yield* new BrowserWorkerAccessError({ reason: "revoked" });
  return scope;
});

export const requireBrowserWorkerLease = Effect.fn("requireBrowserWorkerLease")(
  function* (scope: AccessScope, runId: string, leaseToken: string) {
    yield* requireBrowserWorkerMembership(scope);
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql`SELECT id FROM scheduled_agent_runs
    WHERE id = ${runId} AND status = 'running'
      AND lease_token = ${leaseToken}
      AND lease_expires_at > clock_timestamp() FOR SHARE`;
    if (rows.length !== 1)
      return yield* new BrowserWorkerAccessError({ reason: "lease_inactive" });
    return scope;
  }
);

export const requireBrowserWorkerScheduleActive = Effect.fn(
  "requireBrowserWorkerScheduleActive"
)(function* (scope: AccessScope, scheduleId: string) {
  yield* requireBrowserWorkerMembership(scope);
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT id FROM scheduled_agent_jobs
    WHERE id = ${scheduleId}
      AND workspace_id = ${scope.workspaceId}
      AND created_by_user_id = ${scope.userId}
      AND status = 'active' FOR SHARE`;
  if (rows.length !== 1)
    return yield* new BrowserWorkerAccessError({ reason: "paused" });
  return scope;
});
