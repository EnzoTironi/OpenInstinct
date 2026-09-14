import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import type { VerifiedSender } from "./index";
import { ChannelAccountError } from "./errors";

/** Called under the account lifecycle transaction; never grants access to a team. */
export const requireArchivableAccount = Effect.fn("requireArchivableAccount")(
  function* (sourceUserId: string, targetUserId: string) {
    const sql = yield* PgClient.PgClient;
    const principalId = `better-auth:${sourceUserId}`;
    const workspaceId = accessScopeForUser(principalId).workspaceId;
    const eligible = yield* sql`SELECT u.id FROM public.user u
      JOIN workspace_memberships m ON m.user_id = ${principalId} AND m.workspace_id = ${workspaceId} AND m.role = 'owner'
      JOIN workspaces w ON w.id = m.workspace_id AND w.organization_id IS NULL
      WHERE u.id = ${sourceUserId} AND u.id <> ${targetUserId}
      AND NOT u."emailVerified" AND NOT COALESCE(u."phoneNumberVerified", false)
      AND NOT EXISTS (SELECT 1 FROM public.account WHERE "userId" = u.id)
      AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE user_id = ${principalId})
      AND NOT EXISTS (SELECT 1 FROM workspace_memberships WHERE user_id = ${principalId} AND workspace_id <> ${workspaceId})
      AND NOT EXISTS (SELECT 1 FROM vault_items WHERE workspace_id = ${workspaceId})
      AND NOT EXISTS (SELECT 1 FROM chats WHERE workspace_id = ${workspaceId} AND channel IS NULL)
      AND NOT EXISTS (SELECT 1 FROM account_archive WHERE source_user_id IN (${sourceUserId}, ${targetUserId}) OR target_user_id = ${sourceUserId})
      FOR UPDATE OF u`;
    if (eligible.length !== 1)
      return yield* new ChannelAccountError({
        reason: "archive_requires_review",
      });
    const busy =
      yield* sql`SELECT 1 FROM channel_identity i WHERE i.user_id = ${sourceUserId}
      AND (EXISTS (SELECT 1 FROM channel_inbox q WHERE q.identity_id = i.id AND q.status = 'dispatching')
        OR EXISTS (SELECT 1 FROM channel_outbox q WHERE q.identity_id = i.id AND q.status = 'dispatching'))
      UNION ALL SELECT 1 FROM scheduled_agent_runs r JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE j.created_by_user_id = ${principalId} AND r.status = 'running' LIMIT 1`;
    if (busy.length)
      return yield* new ChannelAccountError({ reason: "account_busy" });
    return { principalId, workspaceId };
  }
);

/** Only consumeChallenge calls this after both one-use proofs and the fresh session pass. */
export const archiveChannelAccount = Effect.fn("archiveChannelAccount")(
  function* (input: {
    readonly sourceUserId: string;
    readonly targetUserId: string;
    readonly challengeId: string;
    readonly sender: typeof VerifiedSender.Type;
  }) {
    const sql = yield* PgClient.PgClient;
    // Serialize against workspace changes which hold membership shares until commit.
    yield* sql`SELECT user_id FROM workspace_memberships WHERE user_id = ${`better-auth:${input.sourceUserId}`} ORDER BY workspace_id FOR UPDATE`;
    const identities = yield* sql<{
      id: string;
      channel: string;
      installationId: string;
      senderId: string;
    }>`
      SELECT id, channel, installation_id AS "installationId", sender_id AS "senderId"
      FROM channel_identity WHERE user_id = ${input.sourceUserId} AND revoked_at IS NULL
      ORDER BY id FOR UPDATE`;
    if (
      !identities.some(
        (identity) =>
          identity.channel === input.sender.channel &&
          identity.installationId === input.sender.installationId &&
          identity.senderId === input.sender.senderId
      )
    )
      return yield* new ChannelAccountError({ reason: "account_conflict" });
    const source = yield* requireArchivableAccount(
      input.sourceUserId,
      input.targetUserId
    );
    const proof = yield* sql`SELECT id FROM channel_auth_challenge
      WHERE id = ${input.challengeId} AND source_user_id = ${input.sourceUserId}
      AND target_user_id = ${input.targetUserId} AND purpose = 'link'
      AND intended_identity_id IS NOT NULL AND confirmed_sender_id = ${input.sender.senderId}
      AND channel = ${input.sender.channel} AND installation_id = ${input.sender.installationId}
      AND confirmed_at IS NOT NULL AND browser_bound_at IS NOT NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > clock_timestamp()`;
    if (proof.length !== 1)
      return yield* new ChannelAccountError({ reason: "invalid_challenge" });
    yield* sql`INSERT INTO account_archive (source_user_id, target_user_id, workspace_id, challenge_id)
      VALUES (${input.sourceUserId}, ${input.targetUserId}, ${source.workspaceId}, ${input.challengeId})`;
    yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE user_id = ${input.sourceUserId} AND revoked_at IS NULL`;
    for (const identity of identities) {
      // A fresh native address keeps old continuations and approvals on the retired identity.
      yield* sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
        VALUES (${randomUUID()}, ${identity.channel}, ${identity.installationId}, ${identity.senderId}, ${input.targetUserId})`;
    }
    yield* sql`UPDATE channel_outbox q SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
      last_error = 'account_archived' FROM channel_identity i
      WHERE q.identity_id = i.id AND i.user_id = ${input.sourceUserId} AND q.status = 'queued'`;
    yield* sql`UPDATE channel_auth_challenge SET cancelled_at = clock_timestamp()
      WHERE id <> ${input.challengeId} AND consumed_at IS NULL AND cancelled_at IS NULL
      AND (target_user_id = ${input.sourceUserId} OR intended_identity_id IN (SELECT id FROM channel_identity WHERE user_id = ${input.sourceUserId}))`;
    yield* sql`UPDATE scheduled_agent_jobs SET status = 'paused', updated_at = clock_timestamp()
      WHERE created_by_user_id = ${source.principalId} AND status = 'active'`;
    yield* sql`UPDATE workspace_agent_grants SET revoked_at = clock_timestamp()
      WHERE issued_by = ${source.principalId} AND revoked_at IS NULL`;
    yield* sql`UPDATE workspace_bots SET discoverable = false WHERE workspace_id = ${source.workspaceId}`;
    yield* sql`UPDATE user_directory SET discoverable = false WHERE user_id = ${input.sourceUserId}`;
    yield* sql`UPDATE workspace_invites SET status = 'revoked' WHERE target_user_id = ${input.sourceUserId} AND status = 'pending'`;
    yield* sql`DELETE FROM public.session WHERE "userId" = ${input.sourceUserId}`;
    return undefined;
  }
);
