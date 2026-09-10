import { Effect } from "effect";
import type { MemoryOperationContext, MemoryToolsContext } from "eve/memory";
import { PersonalMemory } from "../../server/personal-memory";
import { admitPersonalMemoryFromSession } from "../../server/personal-memory/group-memory-policy";
import { authorizePersonalMemoryPrincipal } from "../../server/personal-memory/principal";

export const authorizePersonalMemoryContext = Effect.fn(
  "authorizePersonalMemoryContext"
)(function* (context: MemoryOperationContext | MemoryToolsContext) {
  // G02: group-scoped sessions must not freely bind/recall personal memory.
  yield* admitPersonalMemoryFromSession(context.session.auth.current);
  const scope = yield* authorizePersonalMemoryPrincipal(
    context.session.auth.current
  );
  const memory = yield* PersonalMemory;
  yield* memory.bind(scope, context.memory);
});
