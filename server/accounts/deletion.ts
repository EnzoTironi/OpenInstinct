import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { DateTime, Effect, Schema } from "effect";
import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export class AccountDeletionError extends Schema.TaggedError<AccountDeletionError>()(
  "AccountDeletionError",
  {
    reason: Schema.Literals([
      "unauthenticated",
      "blocked_sole_owner",
      "unavailable",
    ]),
  }
) {}

const identifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200)
);
const OrganizationActionSchema = Schema.Struct({
  organizationId: identifier,
});
const TransferAdminSchema = Schema.Struct({
  organizationId: identifier,
  targetUserId: identifier,
});
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" });

const externalPending = [
  "vaultwarden",
  "whatsapp",
  "matrix",
  "mem0",
  "backups",
] as const;

const resultSchema = Schema.Struct({
  backupExpiresAt: Schema.String,
  pending: Schema.Array(Schema.String),
  retainedCompany: Schema.Array(Schema.String),
  status: Schema.Literals(["pending_external", "completed"]),
});

/**
 * Durable personal-account deletion. Zoen-controlled rows are erased or kept
 * as company property. Live Mem0, Matrix, Vaultwarden and mautrix stay
 * pending. Tombstones sit outside restored user rows so a backup replay
 * cannot resurrect the account.
 */
export const requestAccountDeletion = Effect.fn("requestAccountDeletion")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    yield* requireLiveSession(actor);
    if (yield* isSoleOrganizationOwner(actor.userId)) {
      yield* persistBlockedRequest(actor.userId);
      return yield* new AccountDeletionError({ reason: "blocked_sole_owner" });
    }
    const personal = accessScopeForUser(actor.userId);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* eraseZoenControlledData(actor.userId, personal.workspaceId);
        return yield* persistCompletedRequest(actor.userId, [
          ...externalPending,
        ]);
      })
    );
  },
  Effect.catchTag(
    "SqlError",
    () => new AccountDeletionError({ reason: "unavailable" })
  )
);

export const requestAccountDeletionFromHeaders = Effect.fn(
  "requestAccountDeletionFromHeaders"
)(function* (headers: Headers) {
  const session = yield* readAuthSession(headers).pipe(
    Effect.catchTag("AuthUnavailable", () =>
      Effect.fail(new AccountDeletionError({ reason: "unavailable" }))
    )
  );
  if (!session)
    return yield* new AccountDeletionError({ reason: "unauthenticated" });
  const userId = `better-auth:${session.user.id}`;
  return yield* requestAccountDeletion({
    authSessionId: session.session.id,
    userId,
    workspaceId: accessScopeForUser(userId).workspaceId,
  });
});

export const transferOrganizationAdmin = Effect.fn("transferOrganizationAdmin")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof TransferAdminSchema.Type
  ) {
    const input = yield* decode(TransferAdminSchema)(raw);
    yield* requireLiveSession(actor);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const access = yield* requireWorkspaceAccess(actor, true);
        if (access.organizationId !== input.organizationId)
          return yield* new AccountDeletionError({ reason: "unavailable" });
        const target =
          yield* sql`UPDATE organization_memberships SET role = 'admin'
          WHERE organization_id = ${input.organizationId} AND user_id = ${input.targetUserId}
            AND role = 'member' RETURNING user_id`;
        if (!target.length)
          return yield* new AccountDeletionError({ reason: "unavailable" });
        yield* sql`UPDATE organization_memberships SET role = 'member'
          WHERE organization_id = ${input.organizationId} AND user_id = ${actor.userId} AND role = 'admin'`;
        yield* sql`UPDATE workspace_memberships SET role = 'admin'
          WHERE user_id = ${input.targetUserId} AND role = 'member'
            AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id = ${input.organizationId})`;
        yield* sql`UPDATE workspace_memberships SET role = 'member'
          WHERE user_id = ${actor.userId} AND role = 'admin'
            AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id = ${input.organizationId})`;
        return { transferred: true as const };
      })
    );
  },
  Effect.catchTag(
    "SqlError",
    () => new AccountDeletionError({ reason: "unavailable" })
  )
);

export const closeOrganizationForDeletion = Effect.fn(
  "closeOrganizationForDeletion"
)(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof OrganizationActionSchema.Type
  ) {
    const input = yield* decode(OrganizationActionSchema)(raw);
    yield* requireLiveSession(actor);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const access = yield* requireWorkspaceAccess(actor, true);
        if (access.organizationId !== input.organizationId)
          return yield* new AccountDeletionError({ reason: "unavailable" });
        const others = yield* sql`SELECT user_id FROM organization_memberships
          WHERE organization_id = ${input.organizationId} AND user_id <> ${actor.userId}`;
        if (others.length)
          return yield* new AccountDeletionError({ reason: "unavailable" });
        yield* sql`DELETE FROM workspaces WHERE organization_id = ${input.organizationId}`;
        return { closed: true as const };
      })
    );
  },
  Effect.catchTag(
    "SqlError",
    () => new AccountDeletionError({ reason: "unavailable" })
  )
);

export const applyAccountDeletionTombstones = Effect.fn(
  "applyAccountDeletionTombstones"
)(
  function* () {
    const sql = yield* PgClient.PgClient;
    const tombs = yield* sql<{
      user_id: string;
    }>`SELECT user_id FROM account_deletion_tombstones`;
    for (const tomb of tombs) {
      const personal = accessScopeForUser(tomb.user_id);
      const raw = rawUserId(tomb.user_id);
      const present = yield* sql`SELECT 1 FROM public."user" WHERE id = ${raw}
        UNION ALL SELECT 1 FROM workspaces WHERE id = ${personal.workspaceId}`;
      if (!present.length) continue;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* eraseZoenControlledData(tomb.user_id, personal.workspaceId);
          yield* persistCompletedRequest(tomb.user_id, [...externalPending]);
        })
      );
    }
    return { applied: tombs.length };
  },
  Effect.catchTag(
    "SqlError",
    () => new AccountDeletionError({ reason: "unavailable" })
  )
);

const requireLiveSession = Effect.fn("requireAccountDeletionSession")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    if (!actor.authSessionId)
      return yield* new AccountDeletionError({ reason: "unauthenticated" });
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql`SELECT 1 FROM public.session
      WHERE id = ${actor.authSessionId} AND "userId" = ${rawUserId(actor.userId)}
        AND "expiresAt" > now()`;
    if (!rows.length)
      return yield* new AccountDeletionError({ reason: "unauthenticated" });
    return undefined;
  }
);

const isSoleOrganizationOwner = Effect.fn("isSoleOrganizationOwner")(function* (
  userId: string
) {
  const sql = yield* PgClient.PgClient;
  const orgs = yield* sql<{
    organization_id: string;
  }>`SELECT organization_id FROM organization_memberships
      WHERE user_id = ${userId} AND role = 'admin'`;
  for (const org of orgs) {
    const otherAdmins = yield* sql`SELECT 1 FROM organization_memberships
        WHERE organization_id = ${org.organization_id} AND role = 'admin'
          AND user_id <> ${userId}`;
    if (otherAdmins.length) continue;
    const remainder = yield* sql`SELECT 1 FROM organization_memberships
          WHERE organization_id = ${org.organization_id} AND user_id <> ${userId}
        UNION ALL SELECT 1 FROM workspaces
          WHERE organization_id = ${org.organization_id}`;
    if (remainder.length) return true;
  }
  return false;
});

const eraseZoenControlledData = Effect.fn("eraseZoenControlledData")(function* (
  userId: string,
  personalWorkspaceId: string
) {
  const sql = yield* PgClient.PgClient;
  const raw = rawUserId(userId);
  yield* sql`UPDATE whatsapp_bridge_drafts SET status = 'cancelled'
      WHERE status IN ('draft', 'authorized', 'queued') AND account_id IN (
        SELECT id FROM whatsapp_bridge_accounts WHERE workspace_id = ${personalWorkspaceId}
      )`;
  yield* sql`UPDATE whatsapp_bridge_shares SET revoked_at = clock_timestamp()
      WHERE revoked_at IS NULL AND chat_id IN (
        SELECT c.id FROM whatsapp_bridge_chats c
        JOIN whatsapp_bridge_accounts a ON a.id = c.account_id
        WHERE a.workspace_id = ${personalWorkspaceId}
      )`;
  yield* sql`UPDATE whatsapp_bridge_chats SET revoked_at = clock_timestamp()
      WHERE revoked_at IS NULL AND account_id IN (
        SELECT id FROM whatsapp_bridge_accounts WHERE workspace_id = ${personalWorkspaceId}
      )`;
  yield* sql`UPDATE whatsapp_bridge_accounts
      SET status = 'revoked', revoked_at = clock_timestamp(), pairing_nonce_hash = 'revoked'
      WHERE workspace_id = ${personalWorkspaceId} AND revoked_at IS NULL`;
  yield* sql`DELETE FROM public.session WHERE "userId" = ${raw}`;
  yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE user_id = ${raw} AND revoked_at IS NULL`;
  yield* sql`UPDATE scheduled_agent_jobs SET status = 'deleted', updated_at = clock_timestamp()
      WHERE created_by_user_id = ${userId} AND status <> 'deleted'`;
  yield* sql`UPDATE channel_outbox q SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL, last_error = 'account_deleted'
      FROM scheduled_agent_report_outputs o JOIN scheduled_agent_runs r ON r.id = o.run_id JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE q.id = o.outbox_id AND j.created_by_user_id = ${userId}
        AND q.status IN ('queued', 'dispatching')`;
  yield* sql`UPDATE workspace_agent_grants SET revoked_at = clock_timestamp()
      WHERE revoked_at IS NULL AND (issued_by = ${userId} OR requester_user_id = ${userId})`;
  yield* sql`UPDATE agent_protocol_tasks t SET state = 'TASK_STATE_CANCELED', updated_at = now()
      FROM workspace_agent_grants g
      WHERE t.grant_id = g.id AND (g.issued_by = ${userId} OR g.requester_user_id = ${userId})
        AND t.state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`;
  yield* sql`UPDATE vault_item_delegations SET revoked_at = clock_timestamp(), wrapped_secret = 'revoked'
      WHERE issued_by = ${userId} AND revoked_at IS NULL`;
  yield* sql`UPDATE whatsapp_bridge_shares SET revoked_at = clock_timestamp()
      WHERE issued_by = ${userId} AND revoked_at IS NULL`;
  yield* sql`DELETE FROM workspace_connections WHERE connected_by = ${userId}`;
  yield* sql`DELETE FROM personal_trust_edges WHERE user_id = ${userId} OR peer_user_id = ${userId}`;
  yield* sql`DELETE FROM personal_trust_invites WHERE from_user_id = ${userId} OR to_user_id = ${userId}`;
  yield* sql`DELETE FROM personal_trust_blocks WHERE user_id = ${userId} OR blocked_user_id = ${userId}`;
  yield* sql`DELETE FROM matrix_identities WHERE user_id = ${userId}`;
  yield* sql`DELETE FROM telemetry_events WHERE user_id = ${userId}`;
  yield* sql`DELETE FROM account_archive WHERE source_user_id = ${raw} OR target_user_id = ${raw}`;
  const company = yield* sql<{
    id: string;
  }>`SELECT w.id FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ${userId} AND w.organization_id IS NOT NULL`;
  for (const workspace of company) {
    yield* sql`DELETE FROM workspace_memory_namespace WHERE workspace_id = ${workspace.id} AND user_id = ${userId}`;
    yield* sql`UPDATE workspace_invites SET status = 'revoked'
        WHERE workspace_id = ${workspace.id} AND ('better-auth:' || target_user_id) = ${userId} AND status = 'pending'`;
    yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspace.id} AND user_id = ${userId}`;
  }
  yield* sql`DELETE FROM organization_memberships WHERE user_id = ${userId}`;
  yield* sql`DELETE FROM workspaces WHERE id = ${personalWorkspaceId} AND organization_id IS NULL`;
  yield* sql`DELETE FROM public."user" WHERE id = ${raw}`;
});

const persistBlockedRequest = Effect.fn("persistBlockedDeletionRequest")(
  function* (userId: string) {
    const sql = yield* PgClient.PgClient;
    yield* sql`INSERT INTO account_deletion_requests(
        id, user_id, status, blocked_reason, backup_expires_at, completed_at
      ) VALUES (${randomUUID()}, ${userId}, 'blocked', 'sole_owner', NULL, NULL)
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'blocked', blocked_reason = 'sole_owner',
        backup_expires_at = NULL, completed_at = NULL`;
  }
);

const persistCompletedRequest = Effect.fn("persistCompletedDeletionRequest")(
  function* (userId: string, pending: readonly string[]) {
    const sql = yield* PgClient.PgClient;
    const backupExpiresAt = DateTime.toDateUtc(
      DateTime.add(yield* DateTime.now, { days: 30 })
    );
    const rows = yield* sql<{
      id: string;
    }>`INSERT INTO account_deletion_requests(
        id, user_id, status, blocked_reason, backup_expires_at, completed_at
      ) VALUES (
        ${randomUUID()}, ${userId}, 'pending_external', NULL, ${backupExpiresAt}, clock_timestamp()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'pending_external', blocked_reason = NULL,
        backup_expires_at = EXCLUDED.backup_expires_at, completed_at = clock_timestamp()
      RETURNING id`;
    const requestId = rows[0]?.id;
    if (!requestId)
      return yield* new AccountDeletionError({ reason: "unavailable" });
    yield* sql`DELETE FROM account_deletion_ledger WHERE request_id = ${requestId}`;
    yield* sql`INSERT INTO account_deletion_tombstones(user_id, request_id)
      VALUES (${userId}, ${requestId})
      ON CONFLICT (user_id) DO UPDATE SET request_id = EXCLUDED.request_id, deleted_at = clock_timestamp()`;
    const ledger: readonly (readonly [string, string])[] = [
      ["sessions", "erased"],
      ["jobs", "erased"],
      ["grants", "erased"],
      ["connections", "erased"],
      ["personal_workspace", "erased"],
      ["conversations", "erased"],
      ["git", "erased"],
      ["company_workspace", "retained_company"],
      ["company_git", "retained_company"],
      ["backups", "backup_held"],
      ...pending
        .filter((surface) => surface !== "backups")
        .map((surface) => [surface, "pending_external"] as const),
    ];
    for (const [surface, status] of ledger) {
      yield* sql`INSERT INTO account_deletion_ledger(id, request_id, surface, status)
        VALUES (${randomUUID()}, ${requestId}, ${surface}, ${status})`;
    }
    return yield* Schema.decodeUnknownEffect(resultSchema)({
      backupExpiresAt: backupExpiresAt.toISOString(),
      pending,
      retainedCompany: ["company_workspace", "company_git", "audit_receipts"],
      status: "pending_external",
    });
  }
);

function rawUserId(userId: string) {
  return userId.startsWith("better-auth:")
    ? userId.slice("better-auth:".length)
    : userId;
}
