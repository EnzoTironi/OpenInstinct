import { Effect } from "effect";
import type {
  MemoryRecallMessage,
  MemoryRecallResult,
  MemoryToolsContext,
  MemoryTurnStartedContext,
} from "eve/memory";
import type { ToolContext } from "eve/tools";

/**
 * P06 unstructured forget + native recall-refresh (fail closed):
 *
 * 1. Eve `fileMemory` `save_memory` / `remove_memory` persists the document.
 * 2. Refresh the recalled projection from the same provider (no second engine).
 * 3. Eve harness applies that refresh before the next model step so forgotten
 *    unstructured notes cannot linger in the mid-turn projection.
 *
 * A crash or error after storage and before a successful refresh must not leave
 * the prior projection authoritative: the mutation is treated as incomplete for
 * model context until refresh succeeds (or a later `turn.started` recall runs).
 *
 * Limits (not claimed here): ordinary conversation/history/summaries may still
 * mention a forgotten fact; full account erase/restore is the durable deletion
 * process in docs/decisions/adr-account-deletion.md, not this refresh path.
 */
export interface RecalledProjection {
  readonly messages: readonly MemoryRecallMessage[];
}

export type RecallRefreshPhase =
  | { readonly kind: "clean"; readonly projection: RecalledProjection }
  | { readonly kind: "dirty"; readonly reason: "mutation-pending-refresh" }
  | { readonly kind: "absent" };

export class RecallRefreshError extends Error {
  readonly reason:
    | "refresh-failed"
    | "stale-projection"
    | "missing-recall"
    | "mutation-tool-unavailable";

  constructor(
    reason: RecallRefreshError["reason"],
    message = "Personal memory recall refresh failed closed."
  ) {
    super(message);
    this.name = "RecallRefreshError";
    this.reason = reason;
  }
}

const MUTATING_MEMORY_TOOLS = new Set(["save_memory", "remove_memory"]);

export function isMutatingMemoryTool(name: string): boolean {
  const bare = name.includes("__") ? (name.split("__").at(-1) ?? name) : name;
  return MUTATING_MEMORY_TOOLS.has(bare);
}

export function recalledProjectionFrom(
  result: MemoryRecallResult
): RecalledProjection {
  if (result == null) return { messages: [] };
  return { messages: result.messages };
}

/**
 * Build the next-model-step note projection after a fileMemory mutation.
 *
 * Refreshed storage truth is authoritative. Prior keyed notes absent from the
 * refresh are dropped (forgotten). Prior unkeyed fragments are never kept —
 * they would resurrect unstructured notes from an older projection.
 */
export function projectNotesForNextModelStep(
  prior: RecalledProjection,
  refreshed: RecalledProjection
): RecalledProjection {
  const refreshedIds = new Set(
    refreshed.messages.flatMap((message) =>
      message.id === undefined ? [] : [message.id]
    )
  );
  const byId = new Map<string, MemoryRecallMessage>();
  const unkeyed: MemoryRecallMessage[] = [];

  for (const message of prior.messages) {
    if (message.id === undefined) continue;
    if (!refreshedIds.has(message.id)) continue;
    byId.set(message.id, message);
  }

  for (const message of refreshed.messages) {
    if (message.id === undefined) {
      unkeyed.push(message);
      continue;
    }
    byId.set(message.id, message);
  }

  return { messages: [...byId.values(), ...unkeyed] };
}

export function projectionContainsNote(
  projection: RecalledProjection,
  text: string
): boolean {
  return projection.messages.some((message) => message.content.includes(text));
}

const refreshRecalledProjection = Effect.fn("refreshRecalledProjection")(
  function* (input: {
    readonly recall: (
      context: MemoryTurnStartedContext
    ) => MemoryRecallResult | Promise<MemoryRecallResult>;
    readonly context: MemoryTurnStartedContext;
  }) {
    const result = yield* Effect.tryPromise({
      try: () => Promise.resolve(input.recall(input.context)),
      catch: (cause) =>
        new RecallRefreshError(
          "refresh-failed",
          cause instanceof Error ? cause.message : String(cause)
        ),
    });
    return recalledProjectionFrom(result);
  }
);

/**
 * Storage then refresh. Success is returned only after refresh completes.
 * Callers must not treat the mutation as model-visible before this succeeds.
 * Refresh failure fails the Effect (fail closed); do not treat prior projection
 * as authoritative for the next model step.
 */
export const executeMemoryMutationWithRecallRefresh = Effect.fn(
  "executeMemoryMutationWithRecallRefresh"
)(function* <MutationResult>(input: {
  readonly mutate: () => MutationResult | Promise<MutationResult>;
  readonly recall: (
    context: MemoryTurnStartedContext
  ) => MemoryRecallResult | Promise<MemoryRecallResult>;
  readonly context: MemoryTurnStartedContext;
  readonly priorProjection?: RecalledProjection;
}) {
  const mutationResult = yield* Effect.tryPromise({
    try: () => Promise.resolve(input.mutate()),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

  const refreshed = yield* refreshRecalledProjection({
    recall: input.recall,
    context: input.context,
  });

  const projection = projectNotesForNextModelStep(
    input.priorProjection ?? { messages: [] },
    refreshed
  );
  const phase: RecallRefreshPhase = { kind: "clean", projection };

  return { mutationResult, projection, phase };
});

export const requireCleanProjectionForNextModelStep = Effect.fn(
  "requireCleanProjectionForNextModelStep"
)(function* (phase: RecallRefreshPhase) {
  if (phase.kind === "dirty") {
    return yield* Effect.fail(
      new RecallRefreshError(
        "stale-projection",
        "Refusing next model step with a dirty recalled projection after memory mutation."
      )
    );
  }
  if (phase.kind === "absent") {
    return yield* Effect.fail(
      new RecallRefreshError(
        "missing-recall",
        "No recalled projection is available for the next model step."
      )
    );
  }
  return phase.projection;
});

export function recallContextFromTools(
  toolsContext: MemoryToolsContext,
  execution: ToolContext
): MemoryTurnStartedContext {
  return {
    abortSignal: execution.abortSignal,
    memory: toolsContext.memory,
    messages: toolsContext.messages,
    operationId: `${toolsContext.session.id}:${execution.callId}:tool.refresh`,
    session: execution.session,
    turn: toolsContext.turn,
    getSandbox: (...args) => execution.getSandbox(...args),
    getSkill: (...args) => execution.getSkill(...args),
  };
}
