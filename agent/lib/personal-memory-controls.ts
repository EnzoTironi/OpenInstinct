import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { MemoryOperationContext, MemoryToolsContext } from "eve/memory";
import { readUserProfile, patchUserProfile } from "@db/services/user-profile";
import type { UserProfilePatch } from "@shared/user-profile/schema";
import { PersonalMemoryError } from "../../server/personal-memory/access";
import { authorizePersonalMemoryPrincipal } from "./personal-memory-access";
import { resolveModeValue } from "./mode";

const requireProfileScope = Effect.fn("requireProfileScope")(function* (
  context: Pick<
    MemoryOperationContext | MemoryToolsContext,
    "session" | "memory"
  >
) {
  const scope = yield* authorizePersonalMemoryPrincipal(
    context.session.auth.current
  );
  if (context.memory.scope.value !== scope.workspaceId)
    return yield* new PersonalMemoryError({ reason: "invalid_binding" });
  return scope;
});

export const recallPersonalProfile = Effect.fn("recallPersonalProfile")(
  function* (context: MemoryOperationContext) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const scope = yield* requireProfileScope(context);
        return yield* readUserProfile(scope);
      })
    );
  }
);

export const updatePersonalProfile = Effect.fn("updatePersonalProfile")(
  function* (
    context: Pick<
      MemoryOperationContext | MemoryToolsContext,
      "session" | "memory"
    >,
    input: UserProfilePatch
  ) {
    if (resolveModeValue(context, { interactive: true }) !== true)
      return yield* new PersonalMemoryError({ reason: "unauthenticated" });
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const scope = yield* requireProfileScope(context);
        return yield* patchUserProfile(scope, input);
      })
    );
  }
);
