import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { UsernameSchema } from "../accounts/directory";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

const teamMemberSchema = Schema.Struct({
  userId: Schema.String,
  username: Schema.NullOr(Schema.String),
  name: Schema.String,
  role: Schema.Literals(["owner", "admin", "member"]),
});
const invitationSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  workspaceId: Schema.String,
  name: Schema.String,
  username: Schema.NullOr(Schema.String),
});

export const readWorkspaceTeam = Effect.fn("readWorkspaceTeam")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const access = yield* requireWorkspaceAccess(actor);
  const sql = yield* PgClient.PgClient;
  if (!access.organizationId)
    return { members: [], invites: [], mayManage: false };
  const members =
    yield* sql`SELECT m.user_id AS "userId", d.username, u.name, m.role FROM workspace_memberships m
    JOIN public.user u ON ('better-auth:' || u.id) = m.user_id LEFT JOIN user_directory d ON d.user_id = u.id
    WHERE m.workspace_id = ${actor.workspaceId} ORDER BY m.role, u.name`;
  const invites =
    access.role === "member"
      ? []
      : yield* sql`SELECT i.id, i.workspace_id AS "workspaceId", COALESCE(w.display_name, 'Zoen') AS name, d.username
    FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN user_directory d ON d.user_id = i.target_user_id
    WHERE i.workspace_id = ${actor.workspaceId} AND i.status = 'pending' AND i.expires_at > now() ORDER BY i.created_at`;
  return {
    members: yield* Schema.decodeUnknownEffect(Schema.Array(teamMemberSchema))(
      members
    ),
    invites: yield* Schema.decodeUnknownEffect(Schema.Array(invitationSchema))(
      invites
    ),
    mayManage: access.role !== "member",
  };
});

export const readWorkspaceInvitations = Effect.fn("readWorkspaceInvitations")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    yield* requireWorkspaceAccess(actor);
    const sql = yield* PgClient.PgClient;
    const rows =
      yield* sql`SELECT i.id, i.workspace_id AS "workspaceId", COALESCE(w.display_name, 'Zoen') AS name, d.username
    FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN user_directory d ON d.user_id = i.invited_by_user_id
    WHERE ('better-auth:' || i.target_user_id) = ${actor.userId} AND i.status = 'pending' AND i.expires_at > now() ORDER BY i.created_at DESC LIMIT 50`;
    return yield* Schema.decodeUnknownEffect(Schema.Array(invitationSchema))(
      rows
    );
  }
);

export const inviteWorkspaceMember = Effect.fn("inviteWorkspaceMember")(
  function* (actor: typeof WorkspaceActorSchema.Type, username: string) {
    const handle = yield* Schema.decodeUnknownEffect(UsernameSchema)(username);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const access = yield* requireWorkspaceAccess(actor, true);
        if (!access.organizationId || !actor.authSessionId)
          return yield* new WorkspaceAccessDenied();
        // Exact handles can receive invites. Directory search is separately opt-in.
        const targets = yield* sql<{
          id: string;
        }>`SELECT user_id AS id FROM user_directory WHERE username = ${handle}
          AND NOT EXISTS (SELECT 1 FROM account_archive WHERE source_user_id = user_directory.user_id)`;
        const target = targets[0];
        if (!target || `better-auth:${target.id}` === actor.userId)
          return yield* new WorkspaceAccessDenied();
        const existing =
          yield* sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${`better-auth:${target.id}`}`;
        if (existing.length) return yield* new WorkspaceAccessDenied();
        const id = randomUUID();
        const invited = yield* sql<{
          id: string;
        }>`INSERT INTO workspace_invites(id, workspace_id, target_user_id, invited_by_user_id)
      VALUES (${id}, ${actor.workspaceId}, ${target.id}, ${actor.userId.slice("better-auth:".length)})
      ON CONFLICT (workspace_id, target_user_id) WHERE status = 'pending' DO UPDATE SET expires_at = now() + interval '7 days' RETURNING id`;
        yield* sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, target_user_id, metadata)
      VALUES (${randomUUID()}, ${access.organizationId}, ${actor.userId}, 'invite_created', ${`better-auth:${target.id}`}, ${sql.json({ inviteId: invited[0]?.id, role: "member" })})`;
        return { id: invited[0]?.id };
      })
    );
  }
);

export const answerWorkspaceInvitation = Effect.fn("answerWorkspaceInvitation")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    id: string,
    accept: boolean
  ) {
    yield* Schema.decodeUnknownEffect(Schema.String.check(Schema.isUUID()))(id);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor);
        if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
        const rows = yield* sql<{
          workspace_id: string;
          organization_id: string | null;
        }>`SELECT i.workspace_id, w.organization_id FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.id = ${id} AND ('better-auth:' || i.target_user_id) = ${actor.userId} AND i.status = 'pending' AND i.expires_at > now() FOR UPDATE OF i`;
        const invite = rows[0];
        if (!invite?.organization_id) return yield* new WorkspaceAccessDenied();
        if (accept) {
          yield* sql`INSERT INTO organization_memberships(organization_id, user_id, role) VALUES (${invite.organization_id}, ${actor.userId}, 'member') ON CONFLICT DO NOTHING`;
          yield* sql`INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (${invite.workspace_id}, ${actor.userId}, 'member') ON CONFLICT DO NOTHING`;
        }
        yield* sql`UPDATE workspace_invites SET status = ${accept ? "accepted" : "revoked"} WHERE id = ${id}`;
        yield* sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, target_user_id, metadata)
      VALUES (${randomUUID()}, ${invite.organization_id}, ${actor.userId}, ${accept ? "invite_accepted" : "invite_revoked"}, ${actor.userId}, ${sql.json({ inviteId: id, role: "member" })})`;
        return { workspaceId: invite.workspace_id };
      })
    );
  }
);

export const revokeWorkspaceInvitation = Effect.fn("revokeWorkspaceInvitation")(
  function* (actor: typeof WorkspaceActorSchema.Type, id: string) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const access = yield* requireWorkspaceAccess(actor, true);
        if (!access.organizationId) return yield* new WorkspaceAccessDenied();
        const rows =
          yield* sql`UPDATE workspace_invites SET status = 'revoked' WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND status = 'pending' RETURNING id`;
        if (!rows.length) return yield* new WorkspaceAccessDenied();
        yield* sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, metadata)
      VALUES (${randomUUID()}, ${access.organizationId}, ${actor.userId}, 'invite_revoked', ${sql.json({ inviteId: id })})`;
        return { revoked: true };
      })
    );
  }
);

export const removeWorkspaceMember = Effect.fn("removeWorkspaceMember")(
  function* (actor: typeof WorkspaceActorSchema.Type, targetUserId: string) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const access = yield* requireWorkspaceAccess(actor, true);
        if (!access.organizationId || targetUserId === actor.userId)
          return yield* new WorkspaceAccessDenied();
        const removed =
          yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${targetUserId} AND role = 'member' RETURNING user_id`;
        if (!removed.length) return yield* new WorkspaceAccessDenied();
        yield* sql`DELETE FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${targetUserId}`;
        yield* sql`UPDATE workspace_invites SET status = 'revoked' WHERE workspace_id = ${actor.workspaceId} AND ('better-auth:' || target_user_id) = ${targetUserId} AND status = 'pending'`;
        yield* sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, target_user_id, metadata)
      VALUES (${randomUUID()}, ${access.organizationId}, ${actor.userId}, 'member_removed', ${targetUserId}, ${sql.json({})})`;
        return { removed: true };
      })
    );
  }
);
