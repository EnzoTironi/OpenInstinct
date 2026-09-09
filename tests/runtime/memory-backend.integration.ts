import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { MemoryTurnStartedContext } from "eve/memory";
import { fileMemory, MemoryDocumentConflictError } from "eve/memory/file";
import { afterAll, expect, test } from "vitest";
import { createMemoryDocumentBackend } from "../../agent/lib/memory-document-backend";
import { serverRuntime } from "../../server/runtime";

const memoryDocumentBackend = createMemoryDocumentBackend(Effect.void);

async function withDocument(body: (key: string) => Promise<void>) {
  await serverRuntime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const current = yield* sql<{
        name: string;
      }>`SELECT current_database() AS name`;
      if (current[0]?.name !== "companion_runtime_test")
        throw new Error(
          "Memory backend proof requires its dedicated database."
        );
    })
  );
  const key = `backend-proof/${randomUUID()}`;
  try {
    await body(key);
  } finally {
    await serverRuntime.runPromise(
      Effect.flatMap(
        PgClient.PgClient,
        (sql) => sql`DELETE FROM memory_document WHERE key = ${key}`
      )
    );
  }
}

afterAll(() => serverRuntime.dispose());

test("actual adapter creates, reads and maps CAS failures to the native Eve conflict", () =>
  withDocument(async (key) => {
    const signal = new AbortController().signal;
    expect(await memoryDocumentBackend.read({ key, signal })).toBeNull();
    const first = await memoryDocumentBackend.write({
      key,
      signal,
      content: "first document",
      expectedVersion: null,
    });
    expect(await memoryDocumentBackend.read({ key, signal })).toEqual(first);
    const next = await memoryDocumentBackend.write({
      key,
      signal,
      content: "second document",
      expectedVersion: first.version,
    });
    expect(next.version).not.toBe(first.version);
    expect(next.content).toBe("second document");
    await Promise.all(
      [null, first.version].map(async (expectedVersion) => {
        expect(
          await memoryDocumentBackend
            .write({
              key,
              signal,
              content: "must not replace",
              expectedVersion,
            })
            .catch(
              MemoryDocumentConflictError.is.bind(MemoryDocumentConflictError)
            )
        ).toBe(true);
      })
    );
    expect(await memoryDocumentBackend.read({ key, signal })).toEqual(next);
  }));

test("pre-aborted actual adapter reads and writes reject without creating or changing documents", () =>
  withDocument(async (key) => {
    const aborted = AbortSignal.abort(new Error("Memory operation cancelled"));
    const signal = new AbortController().signal;
    await expect(
      memoryDocumentBackend.read({ key, signal: aborted })
    ).rejects.toBeInstanceOf(Error);
    await expect(
      memoryDocumentBackend.write({
        key,
        signal: aborted,
        content: "must not create",
        expectedVersion: null,
      })
    ).rejects.toBeInstanceOf(Error);
    expect(await memoryDocumentBackend.read({ key, signal })).toBeNull();
    const first = await memoryDocumentBackend.write({
      key,
      signal,
      content: "keep this version",
      expectedVersion: null,
    });
    await expect(
      memoryDocumentBackend.write({
        key,
        signal: aborted,
        content: "must not update",
        expectedVersion: first.version,
      })
    ).rejects.toBeInstanceOf(Error);
    await expect(
      memoryDocumentBackend.read({ key, signal: aborted })
    ).rejects.toBeInstanceOf(Error);
    expect(await memoryDocumentBackend.read({ key, signal })).toEqual(first);
  }));

test("native fileMemory recall reads the context scope through the actual adapter and PostgreSQL", () =>
  withDocument(async (key) => {
    const abortSignal = new AbortController().signal;
    const content =
      "<!-- eve-memory-file-v1 lastAllocatedIndex=0 -->\n0: Prefer concise replies.\n";
    const seeded = await memoryDocumentBackend.write({
      key,
      signal: abortSignal,
      content,
      expectedVersion: null,
    });
    const context: MemoryTurnStartedContext = {
      abortSignal,
      memory: {
        scope: { key, namespace: "backend-proof", value: key },
        slot: "profile",
      },
      messages: [],
      operationId: randomUUID(),
      session: {
        id: randomUUID(),
        auth: { current: null, initiator: null },
        turn: { id: "memory-recall", sequence: 1 },
      },
      turn: { id: "memory-recall", input: [], sequence: 1 },
      async getSandbox() {
        throw new Error("Recall must not access a sandbox.");
      },
      getSkill() {
        throw new Error("Recall must not resolve a skill.");
      },
    };
    const provider = fileMemory({ backend: memoryDocumentBackend });
    const recalled = await provider.recall["turn.started"](context);
    expect(recalled?.messages).toHaveLength(1);
    expect(recalled?.messages[0]?.id).toBe("file-memory-document");
    expect(recalled?.messages[0]?.content).toContain(
      "0: Prefer concise replies."
    );
    expect(recalled?.messages[0]?.content).toContain(
      "Persistent memories for profile"
    );
    expect(
      await memoryDocumentBackend.read({ key, signal: abortSignal })
    ).toEqual(seeded);
    expect(
      await provider.recall["turn.started"]({
        ...context,
        memory: {
          ...context.memory,
          scope: { ...context.memory.scope, key: `${key}/missing` },
        },
      })
    ).toBeNull();
  }));

test("aborting a real lock-blocked adapter write cannot commit after the lock is released", () =>
  withDocument(async (key) => {
    const signal = new AbortController().signal;
    const first = await memoryDocumentBackend.write({
      key,
      signal,
      content: "keep locked document",
      expectedVersion: null,
    });
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<undefined>();
    const locker = serverRuntime.runPromise(
      Effect.flatMap(PgClient.PgClient, (sql) =>
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT key FROM memory_document WHERE key = ${key} FOR UPDATE`;
            const rows = yield* sql<{
              pid: number;
            }>`SELECT pg_backend_pid() AS pid`;
            const pid = rows[0]?.pid;
            if (!pid) throw new Error("Missing lock connection");
            locked.resolve(pid);
            yield* Effect.promise(() => release.promise);
          })
        )
      )
    );
    void locker.catch(locked.reject);
    const controller = new AbortController();
    let writerPid: number | undefined;
    try {
      const lockerPid = await locked.promise;
      const writing = memoryDocumentBackend.write({
        key,
        signal: controller.signal,
        content: "must not commit after abort",
        expectedVersion: first.version,
      });
      const rejection = writing.then(
        () => false,
        () => true
      );
      await expect
        .poll(
          async () => {
            const rows = await serverRuntime.runPromise(
              Effect.flatMap(
                PgClient.PgClient,
                (sql) =>
                  sql<{ pid: number }>`SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND ${lockerPid} = ANY(pg_blocking_pids(pid))`
              )
            );
            writerPid = rows[0]?.pid;
            return rows.length;
          },
          { timeout: 5000, interval: 20 }
        )
        .toBe(1);
      controller.abort(new Error("Cancel blocked memory write"));
      expect(await rejection).toBe(true);
    } finally {
      controller.abort();
      release.resolve(undefined);
      await locker;
    }
    if (!writerPid) throw new Error("No blocked writer observed");
    await expect
      .poll(
        () =>
          serverRuntime.runPromise(
            Effect.flatMap(
              PgClient.PgClient,
              (sql) =>
                sql`SELECT pid FROM pg_stat_activity WHERE pid = ${writerPid} AND state = 'active'
        AND ltrim(query) LIKE 'UPDATE memory_document%'`
            )
          ),
        { timeout: 5000, interval: 20 }
      )
      .toHaveLength(0);
    expect(await memoryDocumentBackend.read({ key, signal })).toEqual(first);
  }));
