import { resolveModeValue } from "@agent/lib/mode";
import {
  defineMemoryProvider,
  type MemoryOperationContext,
  type MemoryProvider,
  type MemoryRecallHandler,
  type MemoryScopeContext,
} from "eve/memory";
import { z } from "zod";

export function resolveProfileMemoryScope(context: MemoryScopeContext) {
  const caller = context.session.auth.current;
  const workspaceId = z.string().safeParse(caller?.attributes.workspaceId);

  const scope =
    caller?.principalType === "user" && workspaceId.success
      ? workspaceId.data
      : null;

  return resolveModeValue(context, {
    interactive: scope,
    "scheduled-worker": scope,
  });
}

export function preserveProfileMemoryCancellation(provider: MemoryProvider) {
  const compactionRecall = provider.recall["compaction.completed"];

  return defineMemoryProvider({
    ...provider,
    recall: {
      "turn.started": (context) =>
        recallWithCancellationReason(provider.recall["turn.started"], context),
      "compaction.completed": (context) =>
        compactionRecall
          ? recallWithCancellationReason(compactionRecall, context)
          : undefined,
    },
  });
}

async function recallWithCancellationReason<
  Context extends MemoryOperationContext,
>(handler: MemoryRecallHandler<Context>, context: Context) {
  try {
    return await handler(context);
  } catch (error) {
    if (context.abortSignal.aborted) {
      context.abortSignal.throwIfAborted();
    }

    throw error;
  }
}
