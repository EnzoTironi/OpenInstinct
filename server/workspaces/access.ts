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
  authSessionId: Schema.optionalKey(identifier),
  channelIdentityId: Schema.optionalKey(identifier),
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
    if (actor.authSessionId && !actor.channelIdentityId) {
      const sessions = yield* sql`SELECT id FROM public.session
      WHERE id = ${actor.authSessionId} AND ('better-auth:' || "userId") = ${actor.userId}
      AND "expiresAt" > clock_timestamp() FOR SHARE`;
      if (sessions.length !== 1) return yield* new WorkspaceAccessDenied();
    } else if (actor.channelIdentityId && !actor.authSessionId) {
      // Shared rooms require an explicit, verified room-to-workspace binding.
      if (actor.workspaceId !== accessScopeForUser(actor.userId).workspaceId)
        return yield* new WorkspaceAccessDenied();
      const identities = yield* sql`SELECT id FROM channel_identity
      WHERE id = ${actor.channelIdentityId} AND ('better-auth:' || user_id) = ${actor.userId}
      AND revoked_at IS NULL FOR SHARE`;
      if (identities.length !== 1) return yield* new WorkspaceAccessDenied();
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
  const actor = yield* Schema.decodeUnknownEffect(WorkspaceActorSchema)({
    userId: principal.principalId,
    workspaceId: principal.attributes.workspaceId,
    ...(principal.authenticator === "authjs"
      ? { authSessionId: principal.attributes.authSessionId }
      : principal.authenticator === "verified-channel"
        ? { channelIdentityId: principal.attributes.channelIdentityId }
        : {}),
  }).pipe(Effect.mapError(() => new WorkspaceAccessDenied()));
  return yield* requireWorkspaceAccess(actor);
});
