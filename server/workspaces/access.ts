import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type { SessionAuthContext } from "eve/context";
import { accessScopeForUser } from "@shared/identity/access-scope";

const identifier = Schema.NonEmptyString.check(
  Schema.isTrimmed(),
  Schema.isMaxLength(200)
);

export const WorkspaceActorSchema = Schema.Struct({
  userId: identifier,
  workspaceId: identifier,
  authSessionId: Schema.optional(identifier),
  channelIdentityId: Schema.optional(identifier),
  agentGrantId: Schema.optional(Schema.String.check(Schema.isUUID())),
  protocolTaskId: Schema.optional(Schema.String.check(Schema.isUUID())),
  scheduledRunId: Schema.optional(Schema.String.check(Schema.isUUID())),
  scheduledRunLeaseToken: Schema.optional(Schema.String.check(Schema.isUUID())),
  groupBindingId: Schema.optional(Schema.String.check(Schema.isUUID())),
  groupEpoch: Schema.optional(Schema.String.check(Schema.isUUID())),
  matrixIdentityId: Schema.optional(identifier),
});

export class WorkspaceAccessDenied extends Schema.TaggedError<WorkspaceAccessDenied>()(
  "WorkspaceAccessDenied",
  {}
) {}

/** Call inside the transaction that reads or publishes protected data. */
export const requireWorkspaceAccess = Effect.fn("requireWorkspaceAccess")(
  function* (input: typeof WorkspaceActorSchema.Type, manage = false) {
    const actor = yield* Schema.decodeUnknownEffect(WorkspaceActorSchema)(
      input
    ).pipe(Effect.mapError(() => new WorkspaceAccessDenied()));
    if (
      [
        actor.authSessionId,
        actor.channelIdentityId,
        actor.agentGrantId,
        actor.scheduledRunId,
        actor.matrixIdentityId,
      ].filter(Boolean).length !== 1 ||
      (actor.protocolTaskId && !actor.agentGrantId) ||
      (manage &&
        (actor.agentGrantId || actor.scheduledRunId || actor.groupBindingId))
    )
      return yield* new WorkspaceAccessDenied();
    const sql = yield* PgClient.PgClient;
    const memberships = yield* sql<{
      role: string;
      organization_id: string | null;
    }>`
    SELECT m.role, w.organization_id FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${actor.userId} AND m.workspace_id = ${actor.workspaceId}
    FOR SHARE OF m, w`;
    const membership = memberships[0];
    if (!membership || (manage && membership.role === "member"))
      return yield* new WorkspaceAccessDenied();
    if (membership.organization_id === null) {
      if (
        actor.workspaceId !== accessScopeForUser(actor.userId).workspaceId ||
        membership.role !== "owner"
      )
        return yield* new WorkspaceAccessDenied();
    } else {
      const org = yield* sql`SELECT user_id FROM organization_memberships
      WHERE organization_id = ${membership.organization_id} AND user_id = ${actor.userId} FOR SHARE`;
      if (org.length !== 1) return yield* new WorkspaceAccessDenied();
    }
    if (actor.agentGrantId) {
      const grants = yield* sql`SELECT g.id FROM workspace_agent_grants g
      JOIN workspace_bots b ON b.id = g.bot_id
      WHERE g.id = ${actor.agentGrantId} AND g.issued_by = ${actor.userId}
        AND b.workspace_id = ${actor.workspaceId} AND g.revoked_at IS NULL
        AND g.expires_at > clock_timestamp() FOR SHARE OF g, b`;
      if (grants.length !== 1 || membership.role === "member")
        return yield* new WorkspaceAccessDenied();
      if (actor.protocolTaskId) {
        const tasks =
          yield* sql`SELECT id FROM agent_protocol_tasks WHERE id = ${actor.protocolTaskId}
          AND grant_id = ${actor.agentGrantId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING') FOR SHARE`;
        if (tasks.length !== 1) return yield* new WorkspaceAccessDenied();
      }
    } else if (actor.scheduledRunId) {
      if (!actor.scheduledRunLeaseToken)
        return yield* new WorkspaceAccessDenied();
      const runs = yield* sql`SELECT r.id FROM scheduled_agent_runs r
      JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE r.id = ${actor.scheduledRunId} AND r.lease_token = ${actor.scheduledRunLeaseToken}
        AND r.status = 'running' AND r.lease_expires_at > clock_timestamp()
        AND j.status IN ('active', 'completed') AND j.workspace_id = ${actor.workspaceId}
        AND j.created_by_user_id = ${actor.userId} FOR SHARE OF r, j`;
      if (runs.length !== 1) return yield* new WorkspaceAccessDenied();
    } else if (actor.matrixIdentityId) {
      if (
        !actor.groupBindingId ||
        !actor.groupEpoch ||
        !membership.organization_id
      )
        return yield* new WorkspaceAccessDenied();
      const rooms = yield* sql`SELECT b.id FROM workspace_group_bindings b
        JOIN matrix_room_members m ON m.binding_id = b.id AND m.user_id = ${actor.userId}
        JOIN matrix_identities i ON i.user_id = m.user_id AND i.matrix_id = ${actor.matrixIdentityId}
        WHERE b.id = ${actor.groupBindingId} AND b.epoch = ${actor.groupEpoch}
          AND b.workspace_id = ${actor.workspaceId} AND b.channel = 'matrix' AND b.revoked_at IS NULL FOR SHARE OF b, m, i`;
      if (rooms.length !== 1) return yield* new WorkspaceAccessDenied();
    } else if (actor.authSessionId) {
      const sessions = yield* sql`SELECT id FROM public.session
      WHERE id = ${actor.authSessionId} AND ('better-auth:' || "userId") = ${actor.userId}
      AND "expiresAt" > clock_timestamp() FOR SHARE`;
      if (sessions.length !== 1) return yield* new WorkspaceAccessDenied();
    } else if (actor.channelIdentityId) {
      if (
        actor.workspaceId !== accessScopeForUser(actor.userId).workspaceId &&
        !actor.groupBindingId
      )
        return yield* new WorkspaceAccessDenied();
      const identities = yield* sql`SELECT id FROM channel_identity
      WHERE id = ${actor.channelIdentityId} AND ('better-auth:' || user_id) = ${actor.userId}
      AND revoked_at IS NULL FOR SHARE`;
      if (identities.length !== 1) return yield* new WorkspaceAccessDenied();
      if (actor.groupBindingId) {
        const bindings = yield* sql`SELECT b.id FROM workspace_group_bindings b
        JOIN channel_identity i ON i.id = ${actor.channelIdentityId}
        WHERE b.id = ${actor.groupBindingId} AND b.workspace_id = ${actor.workspaceId}
          AND b.channel = i.channel AND b.installation_id = i.installation_id
          AND b.revoked_at IS NULL FOR SHARE OF b`;
        if (bindings.length !== 1) return yield* new WorkspaceAccessDenied();
      }
    } else return yield* new WorkspaceAccessDenied();
    return {
      ...actor,
      role: membership.role,
      organizationId: membership.organization_id,
    };
  }
);

export const workspaceActorFromPrincipal = Effect.fn(
  "workspaceActorFromPrincipal"
)(function* (principal: SessionAuthContext | undefined) {
  if (principal?.principalType !== "user")
    return yield* new WorkspaceAccessDenied();
  if (
    (principal.attributes.chatKind === "group" ||
      (Schema.is(Schema.String)(principal.attributes.conversationScope) &&
        principal.attributes.conversationScope.startsWith("group:"))) &&
    !principal.attributes.groupBindingId
  )
    return yield* new WorkspaceAccessDenied();
  const actor = yield* Schema.decodeUnknownEffect(WorkspaceActorSchema)({
    userId: principal.principalId,
    workspaceId: principal.attributes.workspaceId,
    authSessionId:
      principal.authenticator === "authjs"
        ? principal.attributes.authSessionId
        : undefined,
    channelIdentityId:
      principal.authenticator === "verified-channel"
        ? principal.attributes.channelIdentityId
        : undefined,
    groupBindingId:
      principal.authenticator === "verified-channel" ||
      principal.authenticator === "matrix"
        ? principal.attributes.groupBindingId
        : undefined,
    groupEpoch:
      principal.authenticator === "matrix"
        ? principal.attributes.groupEpoch
        : undefined,
    matrixIdentityId:
      principal.authenticator === "matrix"
        ? principal.attributes.matrixIdentityId
        : undefined,
    agentGrantId:
      principal.authenticator === "a2a"
        ? principal.attributes.agentGrantId
        : undefined,
    protocolTaskId:
      principal.authenticator === "a2a"
        ? principal.attributes.protocolTaskId
        : undefined,
    scheduledRunId:
      principal.authenticator === "scheduled-worker"
        ? principal.attributes.scheduledRunId
        : undefined,
    scheduledRunLeaseToken:
      principal.authenticator === "scheduled-worker"
        ? principal.attributes.scheduledRunLeaseToken
        : undefined,
  }).pipe(Effect.mapError(() => new WorkspaceAccessDenied()));
  return yield* requireWorkspaceAccess(actor);
});
