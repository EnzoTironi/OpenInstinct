import { randomUUID } from "node:crypto";
import { ConfigProvider, Effect, Layer, Result, Schema } from "effect";
import type { PgClient } from "@effect/sql-pg";
import { afterEach, expect, test, vi } from "vitest";
import { LearnedMemory } from "../../server/memory/learned";
import { Mem0 } from "../../server/memory/mem0";
import { drainMemoryErasures } from "../../server/memory/erasure";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { executeWorkspace } from "../../server/executor/workspace";
import { workspaceFixture } from "./workspace-fixture";
import { runtimeDatabase } from "./database";

const services = LearnedMemory.layer.pipe(
  Layer.provideMerge(Mem0.layer),
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);
const requestSchema = Schema.fromJsonString(
  Schema.Struct({
    namespace: Schema.String.check(Schema.isUUID()),
    action: Schema.String,
    operation_id: Schema.optionalKey(Schema.String),
  })
);
const network = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const input = Schema.decodeUnknownSync(requestSchema)(init?.body);
    return Response.json(
      input.action === "list" || input.action === "search"
        ? { results: [] }
        : { ids: [] }
    );
  });
const run = (
  body: (
    value: Effect.Success<ReturnType<typeof workspaceFixture>> & {
      memory: LearnedMemory["Service"];
    }
  ) => Effect.Effect<
    void,
    unknown,
    PgClient.PgClient | LearnedMemory | WorkspaceRepository | Mem0
  >
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* body({
        ...(yield* workspaceFixture()),
        memory: yield* LearnedMemory,
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.orElse(
          ConfigProvider.fromUnknown({
            ZOEN_MEM0_URL: "https://memory.example.invalid",
            ZOEN_MEM0_API_KEY: "synthetic-service-key",
          }),
          ConfigProvider.fromEnv()
        )
      )
    )
  );
afterEach(() => {
  vi.restoreAllMocks();
});

test("partitions personal/work memory and each member; forged workspace access never reaches Mem0", () => {
  const backend = network();
  return run(({ actor, guest, personal, memory }) =>
    Effect.gen(function* () {
      for (const person of [actor, guest, personal])
        yield* memory.write(
          person,
          {
            action: "remember",
            text: "Synthetic preference",
            operationId: randomUUID(),
          },
          false
        );
      const requests = backend.mock.calls.map(([, init]) =>
        Schema.decodeUnknownSync(requestSchema)(init?.body)
      );
      expect(new Set(requests.map((request) => request.namespace)).size).toBe(
        3
      );
      expect(
        requests.every((request) => !request.namespace.includes(actor.userId))
      ).toBe(true);
      const denied = yield* memory
        .read({ ...guest, workspaceId: personal.workspaceId })
        .pipe(Effect.result);
      expect(Result.isFailure(denied) && denied.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      expect(backend).toHaveBeenCalledTimes(3);
    })
  );
});

test("replay is stable, forget tombstones previous recalls, and a scope key cannot be rebound", () => {
  const backend = network();
  const fact = {
    id: randomUUID(),
    memory: "Synthetic old preference",
    createdAt: null,
    updatedAt: null,
  };
  return run(({ actor, memory }) =>
    Effect.gen(function* () {
      backend.mockResolvedValueOnce(Response.json({ results: [fact] }));
      const first = yield* memory.recall(
        actor,
        "opaque-scope-one",
        "recall-one",
        "preference"
      );
      expect(first.results).toEqual([fact]);
      expect(
        yield* memory.recall(
          actor,
          "opaque-scope-one",
          "recall-one",
          "changed query"
        )
      ).toEqual(first);
      expect(backend).toHaveBeenCalledTimes(1);
      yield* memory.write(actor, {
        action: "delete",
        memoryId: fact.id,
        operationId: randomUUID(),
      });
      const stale = yield* memory
        .recall(actor, "opaque-scope-one", "recall-one", "preference")
        .pipe(Effect.result);
      expect(Result.isFailure(stale) && stale.failure).toMatchObject({
        reason: "stale_recall",
      });
      expect(
        (yield* memory.recall(
          actor,
          "opaque-scope-one",
          "recall-two",
          "preference"
        )).results
      ).toEqual([]);
      const rebound = yield* memory
        .recall(actor, "forged-scope", "recall-three", "preference")
        .pipe(Effect.result);
      expect(Result.isFailure(rebound) && rebound.failure).toMatchObject({
        reason: "invalid_input",
      });
      yield* memory.setEnabled(actor, false);
      const before = backend.mock.calls.length;
      expect(
        yield* memory.recall(
          actor,
          "opaque-scope-one",
          "recall-paused",
          "preference"
        )
      ).toEqual({ enabled: false, results: [] });
      expect(backend).toHaveBeenCalledTimes(before);
    })
  );
});

test("an ambiguous deletion fences recall until an explicit clear acknowledges recovery", () => {
  const backend = network();
  return run(({ actor, memory }) =>
    Effect.gen(function* () {
      yield* memory.recall(actor, "scope", "before", "test");
      backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
      const failed = yield* memory
        .write(actor, {
          action: "delete",
          memoryId: randomUUID(),
          operationId: "uncertain-delete",
        })
        .pipe(Effect.result);
      expect(Result.isFailure(failed) && failed.failure).toMatchObject({
        _tag: "Mem0Error",
      });
      const fenced = yield* memory
        .recall(actor, "scope", "after", "test")
        .pipe(Effect.result);
      expect(Result.isFailure(fenced) && fenced.failure).toMatchObject({
        reason: "stale_recall",
      });
      const unrelated = yield* memory
        .write(actor, {
          action: "remember",
          text: "New fact",
          operationId: "new-write",
        })
        .pipe(Effect.result);
      expect(Result.isFailure(unrelated) && unrelated.failure).toMatchObject({
        reason: "stale_recall",
      });
      expect(backend).toHaveBeenCalledTimes(2);
      yield* memory.write(actor, {
        action: "clear",
        operationId: "explicit-recovery",
      });
      expect((yield* memory.read(actor)).needsAttention).toBe(false);
      expect(
        (yield* memory.recall(actor, "scope", "recovered", "test")).results
      ).toEqual([]);
    })
  );
});

test("recovery verifies current memory without replaying an uncertain mutation or restoring old recalls", () => {
  const backend = network();
  return run(({ actor, memory }) =>
    Effect.gen(function* () {
      yield* memory.recall(actor, "scope", "before", "test");
      backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
      yield* memory
        .write(actor, {
          action: "remember",
          text: "Uncertain fact",
          operationId: "uncertain-write",
        })
        .pipe(Effect.result);
      backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
      expect(
        Result.isFailure(yield* memory.recover(actor).pipe(Effect.result))
      ).toBe(true);
      expect((yield* memory.read(actor, undefined, true)).needsAttention).toBe(
        true
      );
      yield* memory.recover(actor);
      expect((yield* memory.read(actor, undefined, true)).needsAttention).toBe(
        false
      );
      const stale = yield* memory
        .recall(actor, "scope", "before", "test")
        .pipe(Effect.result);
      expect(Result.isFailure(stale) && stale.failure).toMatchObject({
        reason: "stale_recall",
      });
      const actions = backend.mock.calls.map(
        ([, init]) => Schema.decodeUnknownSync(requestSchema)(init?.body).action
      );
      expect(actions.filter((action) => action === "remember")).toHaveLength(1);
      expect(actions).not.toContain("clear");
    })
  );
});

test("Executor enforces the published plugin catalog and membership on every call", () => {
  network();
  return run(({ actor, guest, repository, sql }) =>
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
  );
});

test("deleted accounts queue durable memory erasure; a failed service call retains the receipt", () => {
  const backend = network();
  return run(({ actor, personal, memory, sql }) =>
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
      backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
      expect(
        Result.isFailure(yield* drainMemoryErasures().pipe(Effect.result))
      ).toBe(true);
      for (const { id } of partitions) {
        expect(
          yield* sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        ).toHaveLength(1);
      }
      // The isolated test database can contain receipts from previous integration fixtures.
      for (let i = 0; i < 20; i++) {
        if ((yield* drainMemoryErasures()).cleared === 0) break;
      }
      for (const { id } of partitions) {
        expect(
          yield* sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        ).toHaveLength(0);
      }
    })
  );
});
