import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Effect } from "effect";
import type { MemoryTurnStartedContext } from "eve/memory";
import { fileMemory, inMemory } from "eve/memory/file";
import type { ToolContext } from "eve/tools";
import { describe, expect, it } from "vitest";

import {
  executeMemoryMutationWithRecallRefresh,
  isMutatingMemoryTool,
  projectNotesForNextModelStep,
  projectionContainsNote,
  recalledProjectionFrom,
  RecallRefreshError,
  requireCleanProjectionForNextModelStep,
  type RecalledProjection,
} from "../personal-memory-recall-refresh";

const forgottenText = "My favorite color is orange.";

const keptText = "My favorite drink is tea.";

function memoryContext(key: string): MemoryTurnStartedContext {
  const sessionId = randomUUID();

  const principal = {
    principalId: "user-1",
    principalType: "user" as const,
    authenticator: "authjs",
    attributes: {},
  };

  return {
    memory: {
      scope: {
        key,
        namespace: "recall-refresh-test",
        value: "workspace-1",
      },
      slot: "profile",
    },
    session: {
      id: sessionId,
      auth: { current: principal, initiator: principal },
      turn: { id: randomUUID(), sequence: 1 },
    },
    turn: { id: randomUUID(), sequence: 1, input: [] },
    operationId: randomUUID(),
    messages: [],
    abortSignal: new AbortController().signal,
    getSandbox() {
      throw new Error("file memory must not use a sandbox.");
    },
    getSkill() {
      throw new Error("file memory must not load skills.");
    },
  };
}

function toolExecution(
  context: MemoryTurnStartedContext,
  toolName: string
): ToolContext {
  return {
    ...context,
    callId: randomUUID(),
    toolName,
    getToken() {
      throw new Error("unused");
    },
    requireAuth() {
      throw new Error("unused");
    },
  };
}

describe("personal memory unstructured forget + recall-refresh", () => {
  it("identifies Eve fileMemory mutating tools", () => {
    expect(isMutatingMemoryTool("save_memory")).toBe(true);
    expect(isMutatingMemoryTool("remove_memory")).toBe(true);
    expect(isMutatingMemoryTool("profile__save_memory")).toBe(true);
    expect(isMutatingMemoryTool("profile__remove_memory")).toBe(true);
    expect(isMutatingMemoryTool("search")).toBe(false);
  });

  it("supersedes stable recall ids for the next model step", () => {
    const prior: RecalledProjection = {
      messages: [
        { id: "file-memory-document", content: `keep ${forgottenText}` },
      ],
    };

    const refreshed: RecalledProjection = {
      messages: [
        { id: "file-memory-document", content: `keep ${keptText} only` },
      ],
    };

    const next = projectNotesForNextModelStep(prior, refreshed);
    expect(projectionContainsNote(next, forgottenText)).toBe(false);
    expect(projectionContainsNote(next, keptText)).toBe(true);
    expect(next.messages).toHaveLength(1);
  });

  it("after remove, refresh then next model step cannot see stale notes", async () => {
    const backend = inMemory();
    const provider = fileMemory({ backend });
    const context = memoryContext(`recall-refresh:${randomUUID()}`);

    const tools = await provider.tools?.({
      ...context,
      channel: { kind: "eve" },
    });

    assert.ok(tools?.save_memory && tools.remove_memory);
    const saveMemory = tools.save_memory;
    const removeMemory = tools.remove_memory;

    await saveMemory.execute(
      // @ts-expect-error heterogeneous tool map
      { text: forgottenText },
      toolExecution(context, "profile__save_memory")
    );
    await saveMemory.execute(
      // @ts-expect-error heterogeneous tool map
      { text: keptText },
      toolExecution(context, "profile__save_memory")
    );

    const prior = recalledProjectionFrom(
      await provider.recall["turn.started"](context)
    );

    expect(projectionContainsNote(prior, forgottenText)).toBe(true);

    const index = /(?:^|\n)(\d+):.*orange/mu.exec(
      prior.messages[0]?.content ?? ""
    )?.[1];

    assert.ok(index);

    const { projection, phase } = await Effect.runPromise(
      executeMemoryMutationWithRecallRefresh({
        mutate: () =>
          removeMemory.execute(
            // @ts-expect-error heterogeneous tool map
            { index: Number(index) },
            toolExecution(context, "profile__remove_memory")
          ),
        recall: (ctx) => provider.recall["turn.started"](ctx),
        context,
        priorProjection: prior,
      })
    );

    const forNextModelStep = await Effect.runPromise(
      requireCleanProjectionForNextModelStep(phase)
    );

    expect(forNextModelStep).toEqual(projection);
    expect(projectionContainsNote(forNextModelStep, forgottenText)).toBe(false);
    expect(projectionContainsNote(forNextModelStep, keptText)).toBe(true);
    expect(forNextModelStep.messages[0]?.id).toBe("file-memory-document");
  });

  it("fails closed when storage succeeded but refresh did not", async () => {
    const backend = inMemory();
    const provider = fileMemory({ backend });
    const context = memoryContext(`recall-refresh-fail:${randomUUID()}`);

    const tools = await provider.tools?.({
      ...context,
      channel: { kind: "eve" },
    });

    assert.ok(tools?.save_memory && tools.remove_memory);
    const saveMemory = tools.save_memory;
    const removeMemory = tools.remove_memory;

    await saveMemory.execute(
      // @ts-expect-error heterogeneous tool map
      { text: forgottenText },
      toolExecution(context, "profile__save_memory")
    );

    const prior = recalledProjectionFrom(
      await provider.recall["turn.started"](context)
    );

    const index = /(?:^|\n)(\d+):.*orange/mu.exec(
      prior.messages[0]?.content ?? ""
    )?.[1];

    assert.ok(index);

    let stored = false;
    await expect(
      Effect.runPromise(
        executeMemoryMutationWithRecallRefresh({
          mutate: async () => {
            await removeMemory.execute(
              // @ts-expect-error heterogeneous tool map
              { index: Number(index) },
              toolExecution(context, "profile__remove_memory")
            );
            stored = true;
          },
          recall: async () => {
            throw new Error("simulated crash before refresh");
          },
          context,
          priorProjection: prior,
        })
      )
    ).rejects.toMatchObject({ reason: "refresh-failed" });

    expect(stored).toBe(true);

    // Crash after storage before refresh: next model step must not use the
    // pre-mutation projection (fail closed). Re-read storage instead.
    await expect(
      Effect.runPromise(
        requireCleanProjectionForNextModelStep({
          kind: "dirty",
          reason: "mutation-pending-refresh",
        })
      )
    ).rejects.toBeInstanceOf(RecallRefreshError);

    const fromStorage = recalledProjectionFrom(
      await provider.recall["turn.started"](context)
    );

    expect(projectionContainsNote(fromStorage, forgottenText)).toBe(false);
  });

  it("forgets every unstructured note without resurrecting prior projection text", async () => {
    const backend = inMemory();
    const provider = fileMemory({ backend });
    const context = memoryContext(`unstructured-forget:${randomUUID()}`);

    const tools = await provider.tools?.({
      ...context,
      channel: { kind: "eve" },
    });

    assert.ok(tools?.save_memory && tools.remove_memory);
    const saveMemory = tools.save_memory;
    const removeMemory = tools.remove_memory;

    const notes = [
      "Unstructured note: allergies include peanuts.",
      "Unstructured note: prefers window seats.",
      forgottenText,
    ];

    await Effect.runPromise(
      Effect.forEach(
        notes,
        (text) =>
          Effect.tryPromise({
            try: () =>
              Promise.resolve(
                saveMemory.execute(
                  // @ts-expect-error heterogeneous tool map
                  { text },
                  toolExecution(context, "profile__save_memory")
                )
              ),
            catch: (cause) =>
              cause instanceof Error ? cause : new Error(String(cause)),
          }),
        { concurrency: 1 }
      )
    );

    const prior = recalledProjectionFrom(
      await provider.recall["turn.started"](context)
    );

    for (const text of notes) {
      expect(projectionContainsNote(prior, text)).toBe(true);
    }

    const recalledContent = prior.messages[0]?.content ?? "";

    const indexes = [...recalledContent.matchAll(/(?:^|\n)(\d+):/gmu)].map(
      (match) => Number(match[1])
    );

    expect(indexes.length).toBe(notes.length);

    const finalProjection = await Effect.runPromise(
      Effect.fn("personal-memory.finalProjection")(function* () {
        let projection = prior;
        yield* Effect.forEach(
          indexes,
          Effect.fn("personal-memory.removeIndex")(function* (index) {
              const refreshed = yield* executeMemoryMutationWithRecallRefresh({
                mutate: () =>
                  removeMemory.execute(
                    // @ts-expect-error heterogeneous tool map
                    { index },
                    toolExecution(context, "profile__remove_memory")
                  ),
                recall: (ctx) => provider.recall["turn.started"](ctx),
                context,
                priorProjection: projection,
              });

              projection = yield* requireCleanProjectionForNextModelStep(
                refreshed.phase
              );
              expect(projection).toEqual(refreshed.projection);
            }),
          { concurrency: 1 }
        );

        return projection;
      })()
    );

    for (const text of notes) {
      expect(projectionContainsNote(finalProjection, text)).toBe(false);
    }

    expect(
      projectionContainsNote(finalProjection, "No memories are saved.")
    ).toBe(true);
    expect(finalProjection.messages[0]?.id).toBe("file-memory-document");
  });

  it("drops prior keyed notes that refresh no longer returns (no resurrection)", () => {
    const prior: RecalledProjection = {
      messages: [
        { id: "file-memory-document", content: forgottenText },
        { content: "unkeyed stale summary mentioning orange" },
      ],
    };

    const refreshed: RecalledProjection = { messages: [] };
    const next = projectNotesForNextModelStep(prior, refreshed);
    expect(next.messages).toEqual([]);
    expect(projectionContainsNote(next, forgottenText)).toBe(false);
    expect(projectionContainsNote(next, "unkeyed stale")).toBe(false);
  });

  it("fails closed when a mutating tool succeeds without a clean projection phase", async () => {
    await expect(
      Effect.runPromise(
        requireCleanProjectionForNextModelStep({
          kind: "dirty",
          reason: "mutation-pending-refresh",
        })
      )
    ).rejects.toMatchObject({ reason: "stale-projection" });

    await expect(
      Effect.runPromise(
        requireCleanProjectionForNextModelStep({ kind: "absent" })
      )
    ).rejects.toMatchObject({ reason: "missing-recall" });
  });
});
