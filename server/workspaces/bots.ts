import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { DateTime, Effect, Schema } from "effect";
import { UsernameSchema } from "../accounts/directory";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

export const BotProfileSchema = Schema.Struct({
  username: UsernameSchema,
  name: Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  description: Schema.String.check(Schema.isMaxLength(240)),
  discoverable: Schema.Boolean,
});
const botSchema = BotProfileSchema.mapFields((fields) => ({
  ...fields,
  id: Schema.String.check(Schema.isUUID()),
}));
export const AgentGrantInputSchema = Schema.Struct({
  label: Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  capabilities: Schema.Array(Schema.Literals(["files", "ontology"])).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2)
  ),
  days: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })),
});
const grantSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  capabilities: Schema.Array(Schema.String),
  expiresAt: Schema.Date,
  revokedAt: Schema.NullOr(Schema.Date),
});

export const readWorkspaceBot = Effect.fn("readWorkspaceBot")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const access = yield* requireWorkspaceAccess(actor);
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT id, username, name, description, discoverable FROM workspace_bots WHERE workspace_id = ${actor.workspaceId}`;
  const bot = rows[0]
    ? yield* Schema.decodeUnknownEffect(botSchema)(rows[0])
    : null;
  const grants =
    bot && access.role !== "member" && actor.authSessionId
      ? yield* sql`SELECT id, label, capabilities, expires_at AS "expiresAt", revoked_at AS "revokedAt"
        FROM workspace_agent_grants WHERE bot_id = ${bot.id} ORDER BY created_at DESC LIMIT 50`
      : [];
  return {
    bot,
    grants: yield* Schema.decodeUnknownEffect(Schema.Array(grantSchema))(
      grants
    ),
    mayManage: access.role !== "member",
  };
});

export const saveWorkspaceBot = Effect.fn("saveWorkspaceBot")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof BotProfileSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(BotProfileSchema)(raw);
  if (
    ["admin", "support", "security", "zoen", "system", "api", "root"].includes(
      input.username
    )
  )
    return yield* new WorkspaceAccessDenied();
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor, true);
      if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
      const rows =
        yield* sql`INSERT INTO workspace_bots (workspace_id, username, name, description, discoverable)
      VALUES (${actor.workspaceId}, ${input.username}, ${input.name}, ${input.description}, ${input.discoverable})
      ON CONFLICT (workspace_id) DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name,
        description = EXCLUDED.description, discoverable = EXCLUDED.discoverable, updated_at = now()
      RETURNING id, username, name, description, discoverable`;
      return yield* Schema.decodeUnknownEffect(botSchema)(rows[0]);
    })
  );
});

export const searchWorkspaceBots = Effect.fn("searchWorkspaceBots")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  query: string
) {
  const access = yield* requireWorkspaceAccess(actor);
  const prefix = yield* Schema.decodeUnknownEffect(
    Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{1,29}$/))
  )(query.toLowerCase());
  const sql = yield* PgClient.PgClient;
  const rows = access.organizationId
    ? yield* sql`SELECT b.username, b.name, b.description, b.discoverable FROM workspace_bots b
      JOIN workspaces w ON w.id = b.workspace_id
      JOIN organization_memberships org ON org.organization_id = w.organization_id AND org.user_id = ${actor.userId}
      WHERE w.organization_id = ${access.organizationId} AND b.discoverable
        AND starts_with(b.username, ${prefix}) ORDER BY b.username LIMIT 20`
    : yield* sql`SELECT b.username, b.name, b.description, b.discoverable FROM workspace_bots b
      JOIN workspaces w ON w.id = b.workspace_id AND w.organization_id IS NULL
      JOIN workspace_memberships owner ON owner.workspace_id = b.workspace_id AND owner.role = 'owner'
      JOIN personal_trust_edges e ON e.user_id = ${actor.userId} AND e.peer_user_id = owner.user_id
      WHERE b.discoverable AND starts_with(b.username, ${prefix})
        AND NOT EXISTS (
          SELECT 1 FROM personal_trust_blocks blk
          WHERE (blk.user_id = ${actor.userId} AND blk.blocked_user_id = owner.user_id)
             OR (blk.user_id = owner.user_id AND blk.blocked_user_id = ${actor.userId})
        )
      ORDER BY b.username LIMIT 20`;
  return yield* Schema.decodeUnknownEffect(Schema.Array(BotProfileSchema))(
    rows
  );
});

export const issueAgentGrant = Effect.fn("issueAgentGrant")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof AgentGrantInputSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(AgentGrantInputSchema)(raw);
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor, true);
      if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
      const { bot } = yield* readWorkspaceBot(actor);
      if (!bot) return yield* new WorkspaceAccessDenied();
      yield* sql`SELECT id FROM workspace_bots WHERE id = ${bot.id} FOR UPDATE`;
      const active =
        yield* sql`SELECT id FROM workspace_agent_grants WHERE bot_id = ${bot.id} AND revoked_at IS NULL AND expires_at > now()`;
      if (active.length >= 20) return yield* new WorkspaceAccessDenied();
      const token = `zoen_a2a_${randomBytes(32).toString("base64url")}`;
      const id = randomUUID();
      const expiresAt = DateTime.toDateUtc(
        DateTime.add(yield* DateTime.now, { days: input.days })
      );
      yield* sql`INSERT INTO workspace_agent_grants(id, bot_id, issued_by, label, token_hash, capabilities, expires_at)
      VALUES (${id}, ${bot.id}, ${actor.userId}, ${input.label}, ${createHash("sha256").update(token).digest("hex")}, ${JSON.stringify(input.capabilities)}::jsonb, ${expiresAt})`;
      return { id, token, expiresAt };
    })
  );
});

export const revokeAgentGrant = Effect.fn("revokeAgentGrant")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor, true);
      const rows =
        yield* sql`UPDATE workspace_agent_grants g SET revoked_at = COALESCE(revoked_at, now())
      FROM workspace_bots b WHERE g.id = ${id} AND b.id = g.bot_id AND b.workspace_id = ${actor.workspaceId} RETURNING g.id`;
      if (!rows.length) return yield* new WorkspaceAccessDenied();
      return { revoked: true };
    })
  );
});

export const authenticateAgentGrant = Effect.fn("authenticateAgentGrant")(
  function* (authorization: string | null, username: string) {
    const token = yield* Schema.decodeUnknownEffect(
      Schema.String.check(
        Schema.isPattern(/^Bearer zoen_a2a_[A-Za-z0-9_-]{43}$/)
      )
    )(authorization).pipe(Effect.mapError(() => new WorkspaceAccessDenied()));
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql<{
      id: string;
      user_id: string;
      workspace_id: string;
      organization_id: string | null;
    }>`SELECT g.id, g.issued_by AS user_id, b.workspace_id, w.organization_id
    FROM workspace_agent_grants g JOIN workspace_bots b ON b.id = g.bot_id JOIN workspaces w ON w.id = b.workspace_id
    WHERE g.token_hash = ${createHash("sha256").update(token.slice(7)).digest("hex")} AND b.username = ${username}
      AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp()`;
    const grant = rows[0];
    if (!grant) return yield* new WorkspaceAccessDenied();
    const actor = yield* requireWorkspaceAccess({
      userId: grant.user_id,
      workspaceId: grant.workspace_id,
      agentGrantId: grant.id,
    });
    return {
      actor,
      workspaceKind:
        grant.organization_id === null
          ? ("personal" as const)
          : ("company" as const),
    };
  }
);

export const readAgentGrantCapabilities = Effect.fn(
  "readAgentGrantCapabilities"
)(function* (actor: typeof WorkspaceActorSchema.Type) {
  yield* requireWorkspaceAccess(actor);
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT capabilities FROM workspace_agent_grants WHERE id = ${actor.agentGrantId ?? "00000000-0000-0000-0000-000000000000"}`;
  return rows[0]
    ? (yield* Schema.decodeUnknownEffect(
        Schema.Struct({ capabilities: Schema.Array(Schema.String) })
      )(rows[0])).capabilities
    : [];
});
