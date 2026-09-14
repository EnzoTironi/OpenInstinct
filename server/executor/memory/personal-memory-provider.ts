import {
  defineMemoryProvider,
  type MemoryOperationContext,
  type MemoryToolsContext,
  type MemoryToolSet,
  type MemoryTurnStartedContext,
} from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { Effect } from "effect";
import { serverRuntime } from "../../runtime";
import { env } from "@shared/environment/env";
import { createMemoryDocumentBackend } from "@agent/lib/memory-document-backend";
import { authorizePersonalMemoryContext } from "@agent/lib/personal-memory-access";
import { preserveProfileMemoryCancellation } from "@agent/lib/profile-memory";
import {
  executeMemoryMutationWithRecallRefresh,
  isMutatingMemoryTool,
  recallContextFromTools,
  type RecalledProjection,
} from "@agent/lib/personal-memory-recall-refresh";

const fileFor = (context: MemoryOperationContext | MemoryToolsContext) =>
  fileMemory({
    backend: createMemoryDocumentBackend(
      authorizePersonalMemoryContext(context)
    ),
  });

async function recallProjection(
  context: MemoryTurnStartedContext
): Promise<RecalledProjection> {
  const recalled = await fileFor(context).recall["turn.started"](context);
  return { messages: recalled?.messages ?? [] };
}

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
        Object.entries(tools)
          .filter(([name]) => !env.ZOEN_MEM0_URL || name !== "save_memory")
          .map(([name, tool]) => [
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

                if (!isMutatingMemoryTool(name)) {
                  return target.execute(input, executionContext);
                }

                const recallContext = recallContextFromTools(
                  current,
                  executionContext
                );
                const prior = await recallProjection(recallContext);

                // Order: Eve fileMemory mutate → refresh recalled projection →
                // only then return success for the next model step.
                const { mutationResult } = await Effect.runPromise(
                  executeMemoryMutationWithRecallRefresh({
                    mutate: () => target.execute(input, executionContext),
                    recall: (ctx) => fileFor(ctx).recall["turn.started"](ctx),
                    context: recallContext,
                    priorProjection: prior,
                  })
                );
                return mutationResult;
              },
            } satisfies MemoryToolSet[string],
          ])
      );
    },
  })
);
