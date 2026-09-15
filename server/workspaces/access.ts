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

export function personalNetworkId(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

const NetworkKind = Schema.Literals(["company", "personal"]);

const requireConversationNetwork = Effect.fn("requireConversationNetwork")(
  function* (input: {
    requesterUserId: string;
    sourceWorkspaceId: string | null;
    networkKind: string | null;
    networkId: string | null;
    destWorkspaceId: string;
  }) {
    const kind = yield* Schema.decodeUnknownEffect(NetworkKind)(
      input.networkKind
    ).pipe(Effect.mapError(() => new WorkspaceAccessDenied()));
    if (!input.networkId) return yield* new WorkspaceAccessDenied();
    const sql = yield* PgClient.PgClient;
    const source = yield* sql<{
      organization_id: string | null;
      role: string;
    }>`SELECT w.organization_id, m.role FROM workspaces w
      JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = ${input.requesterUserId}
      WHERE w.id = ${input.sourceWorkspaceId} FOR SHARE OF w, m`;
    if (
      !source[0] ||
      (kind === "company"
        ? source[0].organization_id !== input.networkId
        : source[0].organization_id !== null ||
          source[0].role !== "owner" ||
          input.sourceWorkspaceId !==
            accessScopeForUser(input.requesterUserId).workspaceId)
    )
      return yield* new WorkspaceAccessDenied();
    switch (kind) {
      case "company": {
        const rows = yield* sql`SELECT w.id FROM workspaces w
        JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = ${input.requesterUserId}
        WHERE w.id = ${input.destWorkspaceId} AND w.organization_id = ${input.networkId} FOR SHARE OF w, o`;
        if (rows.length !== 1) return yield* new WorkspaceAccessDenied();
        return true;
      }
      case "personal": {
        const rows = yield* sql<{
          owner: string;
        }>`SELECT owner.user_id AS owner FROM workspaces w
        JOIN workspace_memberships owner ON owner.workspace_id = w.id AND owner.role = 'owner'
        JOIN personal_trust_edges e ON e.user_id = ${input.requesterUserId} AND e.peer_user_id = owner.user_id
        WHERE w.id = ${input.destWorkspaceId} AND w.organization_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM personal_trust_blocks b
            WHERE (b.user_id = ${input.requesterUserId} AND b.blocked_user_id = owner.user_id)
               OR (b.user_id = owner.user_id AND b.blocked_user_id = ${input.requesterUserId})
          ) FOR SHARE OF w, owner, e`;
        const owner = rows[0]?.owner;
        if (
          !owner ||
          personalNetworkId(input.requesterUserId, owner) !== input.networkId
        )
          return yield* new WorkspaceAccessDenied();
        return true;
      }
      default: {
        const impossible: never = kind;
        void impossible;
        return yield* new WorkspaceAccessDenied();
      }
    }
  }
);

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
      const grants = yield* sql<{
        id: string;
        requester_user_id: string | null;
        source_workspace_id: string | null;
        network_kind: string | null;
        network_id: string | null;
      }>`SELECT g.id, g.requester_user_id, g.source_workspace_id, g.network_kind, g.network_id FROM workspace_agent_grants g
      JOIN workspace_bots b ON b.id = g.bot_id
      WHERE g.id = ${actor.agentGrantId} AND g.issued_by = ${actor.userId}
        AND b.workspace_id = ${actor.workspaceId} AND g.revoked_at IS NULL
        AND (g.requester_user_id IS NULL OR b.discoverable)
        AND g.expires_at > clock_timestamp() FOR SHARE OF g, b`;
      const grant = grants[0];
      if (!grant || membership.role === "member")
        return yield* new WorkspaceAccessDenied();
      if (grant.requester_user_id)
        yield* requireConversationNetwork({
          requesterUserId: grant.requester_user_id,
          sourceWorkspaceId: grant.source_workspace_id,
          networkKind: grant.network_kind,
          networkId: grant.network_id,
          destWorkspaceId: actor.workspaceId,
        });
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
