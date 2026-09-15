import { randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import type { PgClient } from "@effect/sql-pg";
import { expect, test } from "vitest";
import { LearnedMemory } from "../../server/memory/learned";
import { drainMemoryErasures } from "../../server/memory/erasure";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { executeWorkspace } from "../../server/executor/workspace";
import { workspaceFixture } from "./workspace-fixture";
import { runtimeDatabase } from "./database";

const services = LearnedMemory.layer.pipe(
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);

const run = (
  body: (
    value: Effect.Success<ReturnType<typeof workspaceFixture>> & {
      memory: LearnedMemory["Service"];
    }
  ) => Effect.Effect<
    void,
    unknown,
    PgClient.PgClient | LearnedMemory | WorkspaceRepository
  >
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* body({
        ...(yield* workspaceFixture()),
        memory: yield* LearnedMemory,
      });
    }).pipe(Effect.scoped, Effect.provide(services))
  );

test("partitions personal/work memory and each member; forged workspace access never reaches another namespace", () =>
  run(({ actor, guest, personal, memory, sql }) =>
    Effect.gen(function* () {
      const ids = new Set<string>();
      for (const person of [actor, guest, personal]) {
        const written = yield* memory.write(
          person,
          {
            action: "remember",
            text: "Preferência sintética",
            operationId: randomUUID(),
          },
          false
        );
        ids.add(written.ids[0] ?? "");
      }
      expect(ids.size).toBe(3);
      const namespaces = yield* sql<{
        id: string;
        userId: string;
      }>`SELECT namespace_id AS id, user_id AS "userId" FROM workspace_memory_namespace
        WHERE user_id IN (${actor.userId}, ${guest.userId}, ${personal.userId})`;
      expect(new Set(namespaces.map((row) => row.id)).size).toBe(3);
      const denied = yield* memory
        .read({ ...guest, workspaceId: personal.workspaceId })
        .pipe(Effect.result);
      expect(Result.isFailure(denied) && denied.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      const actorNotes = yield* memory.read(actor);
      expect(actorNotes.results).toHaveLength(1);
      expect(actorNotes.results[0]?.memory).toBe("Preferência sintética");
    })
  ));

test("replay is stable, forget tombstones previous recalls, and a scope key cannot be rebound", () =>
  run(({ actor, memory }) =>
    Effect.gen(function* () {
      const saved = yield* memory.write(
        actor,
        {
          action: "remember",
          text: "Preferência antiga sintética",
          operationId: randomUUID(),
        },
        false
      );
      const factId = saved.ids[0];
      if (!factId) throw new Error("Expected remembered id");
      const first = yield* memory.recall(
        actor,
        "opaque-scope-one",
        "recall-one",
        "preferência"
      );
      expect(first.results.map((item) => item.id)).toEqual([factId]);
      expect(
        yield* memory.recall(
          actor,
          "opaque-scope-one",
          "recall-one",
          "consulta diferente"
        )
      ).toEqual(first);
      yield* memory.write(actor, {
        action: "delete",
        memoryId: factId,
        operationId: randomUUID(),
      });
      const stale = yield* memory
        .recall(actor, "opaque-scope-one", "recall-one", "preferência")
        .pipe(Effect.result);
      expect(Result.isFailure(stale) && stale.failure).toMatchObject({
        reason: "stale_recall",
      });
      expect(
        (yield* memory.recall(
          actor,
          "opaque-scope-one",
          "recall-two",
          "preferência"
        )).results
      ).toEqual([]);
      const rebound = yield* memory
        .recall(actor, "forged-scope", "recall-three", "preferência")
        .pipe(Effect.result);
      expect(Result.isFailure(rebound) && rebound.failure).toMatchObject({
        reason: "invalid_input",
      });
      yield* memory.setEnabled(actor, false);
      expect(
        yield* memory.recall(
          actor,
          "opaque-scope-one",
          "recall-paused",
          "preferência"
        )
      ).toEqual({ enabled: false, results: [] });
    })
  ));

test("a leftover fence blocks writes until recover or explicit clear", () =>
  run(({ actor, memory, sql }) =>
    Effect.gen(function* () {
      yield* memory.recall(actor, "scope", "before", "teste");
      yield* sql`UPDATE workspace_memory_namespace SET pending_operation = 'uncertain-write', pending_hash = 'stale'
        WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`;
      const fenced = yield* memory
        .recall(actor, "scope", "after", "teste")
        .pipe(Effect.result);
      expect(Result.isFailure(fenced) && fenced.failure).toMatchObject({
        reason: "stale_recall",
      });
      const unrelated = yield* memory
        .write(actor, {
          action: "remember",
          text: "Novo fato",
          operationId: "new-write",
        })
        .pipe(Effect.result);
      expect(Result.isFailure(unrelated) && unrelated.failure).toMatchObject({
        reason: "stale_recall",
      });
      yield* memory.write(actor, {
        action: "clear",
        operationId: "explicit-recovery",
      });
      expect((yield* memory.read(actor)).needsAttention).toBe(false);
      expect(
        (yield* memory.recall(actor, "scope", "recovered", "teste")).results
      ).toEqual([]);
    })
  ));

test("recovery verifies current memory without restoring old recalls", () =>
  run(({ actor, memory, sql }) =>
    Effect.gen(function* () {
      yield* memory.write(
        actor,
        {
          action: "remember",
          text: "Fato estável",
          operationId: "stable-write",
        },
        false
      );
      yield* memory.recall(actor, "scope", "before", "teste");
      yield* sql`UPDATE workspace_memory_namespace SET pending_operation = 'uncertain-write', pending_hash = 'stale'
        WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`;
      expect((yield* memory.read(actor, undefined, true)).needsAttention).toBe(
        true
      );
      yield* memory.recover(actor);
      expect((yield* memory.read(actor, undefined, true)).needsAttention).toBe(
        false
      );
      const stale = yield* memory
        .recall(actor, "scope", "before", "teste")
        .pipe(Effect.result);
      expect(Result.isFailure(stale) && stale.failure).toMatchObject({
        reason: "stale_recall",
      });
      expect(
        (yield* memory.recall(actor, "scope", "after-recover", "fato")).results
      ).toHaveLength(1);
    })
  ));

test("Executor enforces the published plugin catalog and membership on every call", () =>
  run(({ actor, guest, repository, sql }) =>
    Effect.gen(function* () {
      const first = yield* repository.write(actor, {
        path: "knowledge/plan.md",
        content: "Launch on Monday",
        expectedRevision: null,
        operationId: randomUUID(),
      });
      const read = yield* executeWorkspace(
        guest,
        'return await tools.workspace.files.search({ query: "Monday" });'
      );
      expect(read.ok).toBe(true);
      expect(read.text).toContain("knowledge/plan.md");
      expect(read.text).toContain("Monday");
      yield* repository.write(actor, {
        path: "plugins/workspace.json",
        content: '{"version":1,"enabled":["memory"]}',
        expectedRevision: first.revision,
        operationId: randomUUID(),
      });
      expect(
        (yield* executeWorkspace(
          guest,
          "return await tools.workspace.files.list({});"
        )).ok
      ).toBe(false);
      expect(
        (yield* executeWorkspace(
          guest,
          "return await tools.credentials.list({});"
        )).ok
      ).toBe(false);
      yield* sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`;
      const removed = yield* executeWorkspace(guest, "return 1;").pipe(
        Effect.result
      );
      expect(Result.isFailure(removed) && removed.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
    })
  ));

test("deleted accounts queue durable memory erasure and drain clears the receipts", () =>
  run(({ actor, personal, memory, sql }) =>
    Effect.gen(function* () {
      yield* memory.read(actor);
      yield* memory.read(personal);
      const partitions = yield* sql<{
        id: string;
      }>`SELECT namespace_id AS id FROM workspace_memory_namespace WHERE user_id = ${actor.userId}`;
      yield* sql`DELETE FROM public.user WHERE id = ${actor.userId.slice("better-auth:".length)}`;
      for (const { id } of partitions) {
        expect(
          yield* sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        ).toHaveLength(1);
      }
      for (let i = 0; i < 20; i++) {
        if ((yield* drainMemoryErasures()).cleared === 0) break;
      }
      for (const { id } of partitions) {
        expect(
          yield* sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        ).toHaveLength(0);
      }
    })
  ));
