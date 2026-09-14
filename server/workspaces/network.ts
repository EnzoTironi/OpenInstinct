import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { DateTime, Effect, Schema } from "effect";
import { UsernameSchema } from "../accounts/directory";
import {
  A2AError,
  acceptProtocolTask,
  type ProtocolTaskChain,
} from "../a2a/tasks";
import {
  personalNetworkId,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { BotProfileSchema } from "./bots";

const identifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128)
);
export const PersonalTrustUsernameSchema = Schema.Struct({
  username: UsernameSchema,
});
export const AnswerPersonalTrustSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  accept: Schema.Boolean,
});
export const ContactNetworkBotSchema = Schema.Struct({
  destUsername: UsernameSchema,
  message: Schema.Struct({
    messageId: identifier,
    role: Schema.Literal("ROLE_USER"),
    parts: Schema.Array(
      Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(8000)) })
    ).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
    contextId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  }),
  originTaskId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
});
const inviteSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  direction: Schema.Literals(["sent", "received"]),
});
const connectionSchema = Schema.Struct({
  username: Schema.String,
  name: Schema.String,
});
const conversationCapabilities = JSON.stringify(["conversation"]);

const requirePersonalActor = Effect.fn("requirePersonalTrustActor")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const access = yield* requireWorkspaceAccess(actor);
  if (access.organizationId || !actor.authSessionId)
    return yield* new WorkspaceAccessDenied();
  return access;
});

const lookupDirectoryUser = Effect.fn("lookupDirectoryUser")(function* (
  username: string
) {
  const handle = yield* Schema.decodeUnknownEffect(UsernameSchema)(username);
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{
    id: string;
  }>`SELECT user_id AS id FROM user_directory WHERE username = ${handle}
    AND NOT EXISTS (SELECT 1 FROM account_archive WHERE source_user_id = user_directory.user_id)`;
  const target = rows[0];
  if (!target) return yield* new WorkspaceAccessDenied();
  return { handle, userId: `better-auth:${target.id}` };
});

const blockedPair = Effect.fn("blockedPersonalPair")(function* (
  left: string,
  right: string
) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT 1 FROM personal_trust_blocks
    WHERE (user_id = ${left} AND blocked_user_id = ${right})
       OR (user_id = ${right} AND blocked_user_id = ${left})`;
  return rows.length > 0;
});

const revokePersonalNetworkGrants = Effect.fn("revokePersonalNetworkGrants")(
  function* (networkId: string) {
    const sql = yield* PgClient.PgClient;
    const revoked =
      yield* sql`UPDATE workspace_agent_grants SET revoked_at = clock_timestamp()
      WHERE network_kind = 'personal' AND network_id = ${networkId} AND revoked_at IS NULL RETURNING id`;
    if (!revoked.length) return;
    yield* sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', updated_at = now()
      WHERE grant_id IN (SELECT id FROM workspace_agent_grants WHERE network_kind = 'personal' AND network_id = ${networkId})
        AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`;
  }
);

const clearPersonalTrust = Effect.fn("clearPersonalTrust")(function* (
  left: string,
  right: string
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`UPDATE personal_trust_invites SET status = 'revoked'
    WHERE status = 'pending' AND (
      (from_user_id = ${left} AND to_user_id = ${right})
      OR (from_user_id = ${right} AND to_user_id = ${left})
    )`;
  yield* sql`DELETE FROM personal_trust_edges
    WHERE (user_id = ${left} AND peer_user_id = ${right})
       OR (user_id = ${right} AND peer_user_id = ${left})`;
  yield* revokePersonalNetworkGrants(personalNetworkId(left, right));
});

export const invitePersonalTrust = Effect.fn("invitePersonalTrust")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof PersonalTrustUsernameSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(PersonalTrustUsernameSchema)(
    raw
  );
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requirePersonalActor(actor);
      const peer = yield* lookupDirectoryUser(input.username);
      if (peer.userId === actor.userId)
        return yield* new WorkspaceAccessDenied();
      if (yield* blockedPair(actor.userId, peer.userId))
        return yield* new WorkspaceAccessDenied();
      const connected = yield* sql`SELECT 1 FROM personal_trust_edges
        WHERE user_id = ${actor.userId} AND peer_user_id = ${peer.userId}`;
      if (connected.length) return yield* new WorkspaceAccessDenied();
      const id = randomUUID();
      const invited = yield* sql<{
        id: string;
      }>`INSERT INTO personal_trust_invites(id, from_user_id, to_user_id)
      VALUES (${id}, ${actor.userId}, ${peer.userId})
      ON CONFLICT (from_user_id, to_user_id) WHERE status = 'pending'
      DO UPDATE SET expires_at = now() + interval '7 days' RETURNING id`;
      const inviteId = invited[0]?.id;
      if (!inviteId) return yield* new WorkspaceAccessDenied();
      return { id: inviteId };
    })
  );
});

export const answerPersonalTrust = Effect.fn("answerPersonalTrust")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof AnswerPersonalTrustSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(AnswerPersonalTrustSchema)(
    raw
  );
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requirePersonalActor(actor);
      const rows = yield* sql<{
        from_user_id: string;
      }>`SELECT from_user_id FROM personal_trust_invites
      WHERE id = ${input.id} AND to_user_id = ${actor.userId} AND status = 'pending'
        AND expires_at > now() FOR UPDATE`;
      const invite = rows[0];
      if (!invite) return yield* new WorkspaceAccessDenied();
      if (yield* blockedPair(actor.userId, invite.from_user_id))
        return yield* new WorkspaceAccessDenied();
      if (input.accept) {
        yield* sql`INSERT INTO personal_trust_edges(user_id, peer_user_id) VALUES
          (${actor.userId}, ${invite.from_user_id}), (${invite.from_user_id}, ${actor.userId})
          ON CONFLICT DO NOTHING`;
      }
      yield* sql`UPDATE personal_trust_invites SET status = ${input.accept ? "accepted" : "declined"}
        WHERE id = ${input.id}`;
      return { accepted: input.accept };
    })
  );
});

export const endPersonalTrust = Effect.fn("endPersonalTrust")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof PersonalTrustUsernameSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(PersonalTrustUsernameSchema)(
    raw
  );
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requirePersonalActor(actor);
      const peer = yield* lookupDirectoryUser(input.username);
      yield* clearPersonalTrust(actor.userId, peer.userId);
      return { ended: true };
    })
  );
});

export const blockPersonalTrust = Effect.fn("blockPersonalTrust")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof PersonalTrustUsernameSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(PersonalTrustUsernameSchema)(
    raw
  );
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requirePersonalActor(actor);
      const peer = yield* lookupDirectoryUser(input.username);
      if (peer.userId === actor.userId)
        return yield* new WorkspaceAccessDenied();
      yield* clearPersonalTrust(actor.userId, peer.userId);
      yield* sql`INSERT INTO personal_trust_blocks(user_id, blocked_user_id)
        VALUES (${actor.userId}, ${peer.userId}) ON CONFLICT DO NOTHING`;
      return { blocked: true };
    })
  );
});

export const listPersonalNetwork = Effect.fn("listPersonalNetwork")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  yield* requirePersonalActor(actor);
  const sql = yield* PgClient.PgClient;
  const invites = yield* sql`SELECT i.id, d.username,
      CASE WHEN i.from_user_id = ${actor.userId} THEN 'sent' ELSE 'received' END AS direction
    FROM personal_trust_invites i
    JOIN user_directory d ON ('better-auth:' || d.user_id) = CASE
      WHEN i.from_user_id = ${actor.userId} THEN i.to_user_id ELSE i.from_user_id END
    WHERE i.status = 'pending' AND i.expires_at > now()
      AND (i.from_user_id = ${actor.userId} OR i.to_user_id = ${actor.userId})
    ORDER BY i.created_at`;
  const connections =
    yield* sql`SELECT d.username, u.name FROM personal_trust_edges e
    JOIN public.user u ON ('better-auth:' || u.id) = e.peer_user_id
    JOIN user_directory d ON d.user_id = u.id
    WHERE e.user_id = ${actor.userId} ORDER BY d.username`;
  return {
    invites: yield* Schema.decodeUnknownEffect(Schema.Array(inviteSchema))(
      invites
    ),
    connections: yield* Schema.decodeUnknownEffect(
      Schema.Array(connectionSchema)
    )(connections),
  };
});

const resolvePublishedBot = Effect.fn("resolvePublishedNetworkBot")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  username: string
) {
  const access = yield* requireWorkspaceAccess(actor);
  const handle = yield* Schema.decodeUnknownEffect(UsernameSchema)(username);
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{
    id: string;
    username: string;
    name: string;
    description: string;
    workspace_id: string;
    organization_id: string | null;
    issued_by: string;
    owner_id: string | null;
  }>`SELECT DISTINCT ON (b.id) b.id, b.username, b.name, b.description, b.workspace_id,
        w.organization_id, issuer.user_id AS issued_by, owner.user_id AS owner_id
      FROM workspace_bots b
      JOIN workspaces w ON w.id = b.workspace_id
      JOIN workspace_memberships issuer ON issuer.workspace_id = b.workspace_id AND issuer.role IN ('owner', 'admin')
      LEFT JOIN workspace_memberships owner ON owner.workspace_id = b.workspace_id AND owner.role = 'owner'
      WHERE b.username = ${handle} AND b.discoverable
      ORDER BY b.id, CASE issuer.role WHEN 'owner' THEN 0 ELSE 1 END`;
  const bot = rows[0];
  if (!bot) return yield* new WorkspaceAccessDenied();
  if (access.organizationId) {
    if (bot.organization_id !== access.organizationId)
      return yield* new WorkspaceAccessDenied();
    const member = yield* sql`SELECT 1 FROM workspace_memberships
        WHERE workspace_id = ${bot.workspace_id} AND user_id = ${actor.userId}`;
    if (!member.length) return yield* new WorkspaceAccessDenied();
    return {
      ...bot,
      networkKind: "company" as const,
      networkId: access.organizationId,
    };
  }
  if (bot.organization_id !== null || !bot.owner_id)
    return yield* new WorkspaceAccessDenied();
  if (yield* blockedPair(actor.userId, bot.owner_id))
    return yield* new WorkspaceAccessDenied();
  const edge = yield* sql`SELECT 1 FROM personal_trust_edges
      WHERE user_id = ${actor.userId} AND peer_user_id = ${bot.owner_id}`;
  if (!edge.length) return yield* new WorkspaceAccessDenied();
  return {
    ...bot,
    networkKind: "personal" as const,
    networkId: personalNetworkId(actor.userId, bot.owner_id),
  };
});

const conversationGrant = Effect.fn("conversationNetworkGrant")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  bot: {
    id: string;
    issued_by: string;
    workspace_id: string;
    networkKind: "company" | "personal";
    networkId: string;
  },
  originBotId: string | null
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`SELECT id FROM workspace_bots WHERE id = ${bot.id} FOR UPDATE`;
  const existing = yield* sql<{
    id: string;
  }>`SELECT id FROM workspace_agent_grants
    WHERE bot_id = ${bot.id} AND requester_user_id = ${actor.userId}
      AND network_kind = ${bot.networkKind} AND network_id = ${bot.networkId}
      AND origin_bot_id IS NOT DISTINCT FROM ${originBotId}
      AND revoked_at IS NULL AND expires_at > now()
      AND capabilities = ${conversationCapabilities}::jsonb
    FOR UPDATE`;
  if (existing[0])
    return {
      id: existing[0].id,
      issuedBy: bot.issued_by,
      workspaceId: bot.workspace_id,
    };
  const active =
    yield* sql`SELECT id FROM workspace_agent_grants WHERE bot_id = ${bot.id} AND revoked_at IS NULL AND expires_at > now()`;
  if (active.length >= 20) return yield* new WorkspaceAccessDenied();
  const token = `zoen_a2a_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const expiresAt = DateTime.toDateUtc(
    DateTime.add(yield* DateTime.now, { days: 7 })
  );
  yield* sql`INSERT INTO workspace_agent_grants(id, bot_id, issued_by, label, token_hash, capabilities, expires_at, requester_user_id, network_kind, network_id, origin_bot_id)
    VALUES (${id}, ${bot.id}, ${bot.issued_by}, 'Network conversation', ${createHash("sha256").update(token).digest("hex")}, ${conversationCapabilities}::jsonb, ${expiresAt}, ${actor.userId}, ${bot.networkKind}, ${bot.networkId}, ${originBotId})`;
  return { id, issuedBy: bot.issued_by, workspaceId: bot.workspace_id };
});

export const contactNetworkBot = Effect.fn("contactNetworkBot")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof ContactNetworkBotSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(ContactNetworkBotSchema)(
    raw,
    {
      onExcessProperty: "error",
    }
  );
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
      yield* requireWorkspaceAccess(actor);
      const dest = yield* resolvePublishedBot(actor, input.destUsername);
      let chain: ProtocolTaskChain | undefined;
      let originBotId: string | null = null;
      if (input.originTaskId) {
        const origin = yield* sql<{
          id: string;
          correlation_id: string;
          round: number;
          bot_id: string;
          workspace_id: string;
        }>`SELECT t.id, t.correlation_id, t.round, g.bot_id, b.workspace_id
          FROM agent_protocol_tasks t
          JOIN workspace_agent_grants g ON g.id = t.grant_id
          JOIN workspace_bots b ON b.id = g.bot_id
          WHERE t.id = ${input.originTaskId}`;
        const source = origin[0];
        if (!source || source.workspace_id !== actor.workspaceId)
          return yield* new WorkspaceAccessDenied();
        if (source.bot_id === dest.id)
          return yield* new WorkspaceAccessDenied();
        const started = yield* sql<{
          started: string;
        }>`SELECT min(created_at)::text AS started FROM agent_protocol_tasks WHERE correlation_id = ${source.correlation_id}`;
        if (
          started[0] &&
          Date.now() - Date.parse(started[0].started) > 10 * 60 * 1000
        )
          return yield* new A2AError({
            code: -32000,
            message: "Task chain expired",
          });
        const round = source.round + 1;
        if (round > 8)
          return yield* new A2AError({
            code: -32000,
            message: "Task chain limit reached",
          });
        originBotId = source.bot_id;
        chain = {
          correlationId: source.correlation_id,
          round,
          originTaskId: source.id,
        };
      }
      const grant = yield* conversationGrant(actor, dest, originBotId);
      const destActor = {
        userId: grant.issuedBy,
        workspaceId: grant.workspaceId,
        agentGrantId: grant.id,
      };
      const task = yield* acceptProtocolTask(
        destActor,
        { message: input.message },
        chain
      );
      return {
        task,
        dest: yield* Schema.decodeUnknownEffect(BotProfileSchema)({
          username: dest.username,
          name: dest.name,
          description: dest.description,
          discoverable: true,
        }),
        network: { kind: dest.networkKind, id: dest.networkId },
        destActor,
      };
    })
  );
});
