import { Effect } from "effect";
import type { MemoryOperationContext, MemoryToolsContext } from "eve/memory";
import { PersonalMemory } from "../../server/personal-memory";
import { authorizePersonalMemoryPrincipal } from "../../server/personal-memory/principal";

export const authorizePersonalMemoryContext = Effect.fn(
  "authorizePersonalMemoryContext"
)(function* (context: MemoryOperationContext | MemoryToolsContext) {
  const scope = yield* authorizePersonalMemoryPrincipal(
    context.session.auth.current
  );
  const memory = yield* PersonalMemory;
  yield* memory.bind(scope, context.memory);
});
