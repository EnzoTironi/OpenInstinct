import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { Identity } from "../../server/accounts";
import { accessScopeForUser } from "../../shared/identity/access-scope";

type Sender = Pick<Identity, "channel" | "installationId" | "senderId">;

/**
 * Leaves behind what Google sign-in plus a consumed link challenge produce:
 * a user, its personal workspace and membership, and the linked identity.
 * Production code never creates users from a messenger contact.
 */
export const linkedIdentity = Effect.fn("identity.fixture")(function* (
  sender: Sender,
  options?: { readonly userId?: string }
) {
  const sql = yield* PgClient.PgClient;
  const userId = options?.userId ?? randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);
  if (!options?.userId) {
    yield* sql`INSERT INTO public.user (id, name, email) VALUES
      (${userId}, 'Synthetic linked user', ${`${userId}@example.invalid`})`;
  }
  yield* sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId}) ON CONFLICT (id) DO NOTHING`;
  yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${scope.workspaceId}, ${scope.userId}, 'owner') ON CONFLICT DO NOTHING`;
  const id = randomUUID();
  yield* sql`INSERT INTO public.channel_identity
    (id, channel, installation_id, sender_id, user_id)
    VALUES (${id}, ${sender.channel}, ${sender.installationId}, ${sender.senderId}, ${userId})`;
  const identity: Identity = { id, userId, ...sender };
  return identity;
});
