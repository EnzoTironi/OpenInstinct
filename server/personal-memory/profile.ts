import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import { readAuthSession } from "@db/services/auth/session";
import { readUserProfile, replaceUserProfile } from "@db/services/user-profile";
import { accessScopeForUser } from "@shared/identity/access-scope";
import type { UserProfile } from "@shared/user-profile/schema";
import { PersonalMemoryError, requirePersonalMemoryWebSession } from "./access";

const profileSession = Effect.fn("profileSession")(function* (
  headers: Headers
) {
  const session = yield* readAuthSession(headers);
  if (!session)
    return yield* new PersonalMemoryError({ reason: "unauthenticated" });
  return {
    scope: accessScopeForUser(`better-auth:${session.user.id}`),
    id: session.session.id,
  };
});

export const readPersonalProfile = Effect.fn("readPersonalProfile")(function* (
  headers: Headers
) {
  const session = yield* profileSession(headers);
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const scope = yield* requirePersonalMemoryWebSession(
        session.scope,
        session.id
      );
      return yield* readUserProfile(scope);
    })
  );
});

export const replacePersonalProfile = Effect.fn("replacePersonalProfile")(
  function* (headers: Headers, input: UserProfile) {
    const session = yield* profileSession(headers);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const scope = yield* requirePersonalMemoryWebSession(
          session.scope,
          session.id
        );
        return yield* replaceUserProfile(scope, input);
      })
    );
  }
);
