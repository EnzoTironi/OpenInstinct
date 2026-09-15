import { toolContextFor } from "../helpers/tool-context";
import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { WorkspaceRepository } from "../../server/workspaces/repository";

export const workspaceFixture = Effect.fn("workspace.fixture")(function* () {
  const sql = yield* PgClient.PgClient;
  const id = randomUUID();
  const userId = `workspace-proof-${id}`;
  const guestId = `workspace-guest-${id}`;
  const orgId = `org-${id}`;
  const workspaceId = `team-${id}`;
  const personal = accessScopeForUser(`better-auth:${userId}`);
  const guestPersonal = accessScopeForUser(`better-auth:${guestId}`);
  const actor = { userId: personal.userId, workspaceId, authSessionId: id };
  const guest = {
    userId: `better-auth:${guestId}`,
    workspaceId,
    authSessionId: guestId,
  };
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM workspaces WHERE id IN (${workspaceId}, ${personal.workspaceId}, ${guestPersonal.workspaceId})`;
      yield* sql`DELETE FROM organization_audit_receipts WHERE organization_id = ${orgId}`;
      yield* sql`DELETE FROM organizations WHERE id = ${orgId}`;
      yield* sql`DELETE FROM public.user WHERE id IN (${userId}, ${guestId})`;
    }).pipe(Effect.orDie)
  );
  yield* sql`INSERT INTO public.user (id, name, email) VALUES
    (${userId}, 'Synthetic owner', ${`${userId}@example.invalid`}),
    (${guestId}, 'Synthetic guest', ${`${guestId}@example.invalid`})`;
  yield* sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES
    (${id}, ${id}, ${userId}, now() + interval '1 hour', now()),
    (${guestId}, ${guestId}, ${guestId}, now() + interval '1 hour', now())`;
  yield* sql`INSERT INTO organizations (id, name) VALUES (${orgId}, 'Synthetic company')`;
  yield* sql`INSERT INTO workspaces (id, organization_id) VALUES (${workspaceId}, ${orgId}), (${personal.workspaceId}, NULL), (${guestPersonal.workspaceId}, NULL)`;
  yield* sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES
    (${orgId}, ${actor.userId}, 'admin'), (${orgId}, ${guest.userId}, 'member')`;
  yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
    (${workspaceId}, ${actor.userId}, 'admin'), (${workspaceId}, ${guest.userId}, 'member'),
    (${personal.workspaceId}, ${actor.userId}, 'owner'), (${guestPersonal.workspaceId}, ${guest.userId}, 'owner')`;
  return {
    sql,
    actor,
    guest,
    personal: { ...actor, workspaceId: personal.workspaceId },
    guestPersonal: { ...guest, workspaceId: guestPersonal.workspaceId },
    repository: yield* WorkspaceRepository,
  };
});

export function workspaceExecutionFor(
  actor: Effect.Success<ReturnType<typeof workspaceFixture>>["actor" | "guest"]
) {
  const base = toolContextFor({
    toolName: "execute",
    callId: randomUUID(),
    sessionId: randomUUID(),
  });
  const principal = {
    principalId: actor.userId,
    principalType: "user",
    authenticator: "authjs",
    attributes: {
      workspaceId: actor.workspaceId,
      authSessionId: actor.authSessionId,
    },
  };
  return {
    ...base,
    session: {
      ...base.session,
      auth: { current: principal, initiator: principal },
    },
  };
}
