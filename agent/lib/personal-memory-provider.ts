import { Effect } from "effect";
import {
  defineMemoryProvider,
  type MemoryOperationContext,
  type MemoryToolsContext,
} from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { PersonalMemory } from "../../server/personal-memory";
import { serverRuntime } from "../../server/runtime";
import { memoryDocumentBackend } from "./memory-document-backend";
import { scopeFromPrincipal } from "./principal-scope";
import { preserveProfileMemoryCancellation } from "./profile-memory";

const file = fileMemory({ backend: memoryDocumentBackend });

const bind = (context: MemoryOperationContext | MemoryToolsContext) => {
  const principal = context.session.auth.current;
  if (principal?.principalType !== "user")
    throw new Error("An authenticated personal memory owner is required.");
  const scope = scopeFromPrincipal(principal);
  return serverRuntime.runPromise(
    Effect.flatMap(PersonalMemory, (memory) =>
      memory.bind(scope, context.memory)
    ),
    { signal: "abortSignal" in context ? context.abortSignal : undefined }
  );
};

export const personalMemoryProvider = preserveProfileMemoryCancellation(
  defineMemoryProvider({
    recall: {
      async "turn.started"(context) {
        await bind(context);
        return file.recall["turn.started"](context);
      },
      async "compaction.completed"(context) {
        await bind(context);
        return file.recall["compaction.completed"]?.(context);
      },
    },
    async tools(context) {
      await bind(context);
      return file.tools?.(context) ?? null;
    },
  })
);
