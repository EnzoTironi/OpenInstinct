import { readUserProfile, patchUserProfile } from "@db/services/user-profile";
import type { UserProfilePatch } from "@shared/user-profile/schema";
import { Effect } from "effect";
import type { MemoryOperationContext, MemoryToolsContext } from "eve/memory";

import { PersonalMemoryError } from "../../server/personal-memory/access";
import { admitPersonalMemoryFromSession } from "../../server/personal-memory/group-memory-policy";
import { authorizePersonalMemoryPrincipal } from "../../server/personal-memory/principal";
import { resolveModeValue } from "./mode";

const requireProfileScope = Effect.fn("requireProfileScope")(function* (
  context: Pick<
    MemoryOperationContext | MemoryToolsContext,
    "session" | "memory"
  >
) {
  yield* admitPersonalMemoryFromSession(context.session.auth.current);

  const scope = yield* authorizePersonalMemoryPrincipal(
    context.session.auth.current
  );

  if (context.memory.scope.value !== scope.workspaceId)
    return yield* new PersonalMemoryError({ reason: "invalid_binding" });

  return scope;
});

export const recallPersonalProfile = Effect.fn("recallPersonalProfile")(
  function* (context: MemoryOperationContext) {
    return yield* readUserProfile(requireProfileScope(context));
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

    return yield* patchUserProfile(requireProfileScope(context), input);
  }
);
