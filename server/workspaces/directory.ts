import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { requireWorkspaceAccess, type WorkspaceActorSchema } from "./access";

const workspaceSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  role: Schema.Literals(["owner", "admin", "member"]),
  organizationId: Schema.NullOr(Schema.String),
});

export const listUserWorkspaces = Effect.fn("listUserWorkspaces")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  yield* requireWorkspaceAccess(actor);
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT w.id, COALESCE(w.display_name, o.name) AS name, m.role, w.organization_id AS "organizationId"
    FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
    LEFT JOIN organizations o ON o.id = w.organization_id
    WHERE m.user_id = ${actor.userId} AND (w.organization_id IS NULL OR EXISTS (
      SELECT 1 FROM organization_memberships om WHERE om.organization_id = w.organization_id AND om.user_id = ${actor.userId}))
    ORDER BY w.organization_id NULLS FIRST, w.created_at, w.id`;
  return yield* Schema.decodeUnknownEffect(
    Schema.Array(workspaceSummarySchema)
  )(rows);
});

export const createUserWorkspace = Effect.fn("createUserWorkspace")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  name: string
) {
  const title = yield* Schema.decodeUnknownEffect(
    Schema.String.check(
      Schema.isTrimmed(),
      Schema.isMinLength(1),
      Schema.isMaxLength(80)
    )
  )(name);
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor);
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      yield* sql`INSERT INTO organizations (id, name) VALUES (${organizationId}, ${title})`;
      yield* sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${organizationId}, ${actor.userId}, 'admin')`;
      yield* sql`INSERT INTO workspaces (id, organization_id, display_name) VALUES (${workspaceId}, ${organizationId}, ${title})`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${workspaceId}, ${actor.userId}, 'admin')`;
      return { workspaceId };
    })
  );
});
