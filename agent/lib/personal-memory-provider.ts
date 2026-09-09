import {
  defineMemoryProvider,
  type MemoryOperationContext,
  type MemoryToolsContext,
  type MemoryToolSet,
} from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { serverRuntime } from "../../server/runtime";
import { createMemoryDocumentBackend } from "./memory-document-backend";
import { authorizePersonalMemoryContext } from "./personal-memory-access";
import { preserveProfileMemoryCancellation } from "./profile-memory";

const fileFor = (context: MemoryOperationContext | MemoryToolsContext) =>
  fileMemory({
    backend: createMemoryDocumentBackend(
      authorizePersonalMemoryContext(context)
    ),
  });

export const personalMemoryProvider = preserveProfileMemoryCancellation(
  defineMemoryProvider({
    recall: {
      "turn.started": (context) =>
        fileFor(context).recall["turn.started"](context),
      "compaction.completed": (context) =>
        fileFor(context).recall["compaction.completed"]?.(context),
    },
    async tools(context) {
      await serverRuntime.runPromise(authorizePersonalMemoryContext(context));
      const tools = await fileFor(context).tools?.(context);
      if (!tools) return null;
      return Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [
          name,
          {
            ...tool,
            async execute(input, executionContext) {
              const current = {
                ...context,
                session: executionContext.session,
                abortSignal: executionContext.abortSignal,
              };
              const rebound = await fileFor(current).tools?.(current);
              const target = rebound?.[name];
              if (!target)
                throw new Error("Native memory tool is unavailable.");
              return target.execute(input, executionContext);
            },
          } satisfies MemoryToolSet[string],
        ])
      );
    },
  })
);
