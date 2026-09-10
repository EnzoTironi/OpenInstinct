import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";

export class PersonalMemoryError extends Schema.TaggedError<PersonalMemoryError>()(
  "PersonalMemoryError",
  {
    reason: Schema.Literals([
      "unauthenticated",
      "invalid_binding",
      "unavailable",
      "cross_scope",
    ]),
  }
) {}

export const requirePersonalMemoryMembership = Effect.fn(
  "requirePersonalMemoryMembership"
)(function* (scope: AccessScope) {
  const canonical = accessScopeForUser(scope.userId);
  if (canonical.workspaceId !== scope.workspaceId)
    return yield* new PersonalMemoryError({ reason: "unauthenticated" });
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT workspace_id FROM workspace_memberships
    WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId} FOR SHARE`;
  if (rows.length !== 1)
    return yield* new PersonalMemoryError({ reason: "unauthenticated" });
  return scope;
});

export const requirePersonalMemoryWebSession = Effect.fn(
  "requirePersonalMemoryWebSession"
)(
  function* (scope: AccessScope, sessionId: string) {
    yield* requirePersonalMemoryMembership(scope);
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql`SELECT id FROM public.session
      WHERE id = ${sessionId} AND ('better-auth:' || "userId") = ${scope.userId}
        AND "expiresAt" > clock_timestamp() FOR SHARE`;
    if (rows.length !== 1)
      return yield* new PersonalMemoryError({ reason: "unauthenticated" });
    return scope;
  },
  Effect.catchTag(
    "SqlError",
    () => new PersonalMemoryError({ reason: "unavailable" })
  )
);
