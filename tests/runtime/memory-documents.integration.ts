import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";

import {
  MemoryDocuments,
  MemoryDocumentConflict,
  MemoryDocumentInvalidInput,
  MemoryDocumentStorageError,
} from "../../server/memory/documents";
import { runtimeDatabase } from "./database";

const databaseConfig = {
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(8),
};

const services = MemoryDocuments.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);

const fixture = Effect.fn("memory.fixture")(function* (
  body: (
    documents: MemoryDocuments["Service"],
    sql: PgClient.PgClient,
    prefix: string
  ) => Effect.Effect<void, unknown>
) {
  const sql = yield* PgClient.PgClient;
  const prefix = `memory-proof/${randomUUID()}/`;
  yield* Effect.acquireRelease(Effect.succeed(prefix), () =>
    sql`DELETE FROM memory_document WHERE left(key, char_length(${prefix})) = ${prefix}`.pipe(
      Effect.catch((error) => Effect.die(error))
    )
  );
  yield* body(yield* MemoryDocuments, sql, prefix);
});

const run = (body: Parameters<typeof fixture>[0]) =>
  Effect.runPromise(
    fixture(body).pipe(Effect.scoped, Effect.provide(services))
  );

test("creates, reads and isolates keys, including an initially empty document", () =>
  run(
    Effect.fn("run.1")(function* (documents, _sql, prefix) {
      expect(yield* documents.read(`${prefix}missing`)).toBeNull();

      const first = yield* documents.write({
        key: `${prefix}a`,
        content: "stable preference",
        expectedVersion: null,
      });

      const other = yield* documents.write({
        key: `${prefix}b`,
        content: "",
        expectedVersion: null,
      });

      expect(yield* documents.read(`${prefix}a`)).toEqual(first);
      expect(yield* documents.read(`${prefix}b`)).toEqual(other);
      expect(first.version).not.toBe(other.version);
      expect(first.content).toBe("stable preference");
      expect(other.content).toBe("");
    })
  ));

test("concurrent create has exactly one winner and never overwrites it", () =>
  run(
    Effect.fn("run.2")(function* (documents, sql, prefix) {
      const key = `${prefix}race-create`;

      const results = yield* Effect.all(
        Array.from({ length: 12 }, (_, index) =>
          documents
            .write({
              key,
              content: `candidate ${String(index)}`,
              expectedVersion: null,
            })
            .pipe(Effect.result)
        ),
        { concurrency: 8 }
      );

      const winners = results.filter(Result.isSuccess);
      const conflicts = results.filter(Result.isFailure);
      expect(winners).toHaveLength(1);
      expect(conflicts).toHaveLength(11);
      expect(
        conflicts.every(
          (result) => result.failure instanceof MemoryDocumentConflict
        )
      ).toBe(true);
      expect(yield* documents.read(key)).toEqual(winners[0]?.success);

      const rows = yield* sql<{
        count: number;
      }>`SELECT count(*)::int AS count FROM memory_document WHERE key = ${key}`;

      expect(rows[0]?.count).toBe(1);
    })
  ));

test("concurrent updates have exactly one winner; stale and missing versions conflict", () =>
  run(
    Effect.fn("run.3")(function* (documents, _sql, prefix) {
      const key = `${prefix}race-update`;

      const first = yield* documents.write({
        key,
        content: "original",
        expectedVersion: null,
      });

      const results = yield* Effect.all(
        Array.from({ length: 12 }, (_, index) =>
          documents
            .write({
              key,
              content: `update ${String(index)}`,
              expectedVersion: first.version,
            })
            .pipe(Effect.result)
        ),
        { concurrency: 8 }
      );

      const winners = results.filter(Result.isSuccess);
      const conflicts = results.filter(Result.isFailure);
      expect(winners).toHaveLength(1);
      expect(conflicts).toHaveLength(11);
      expect(
        conflicts.every(
          (result) => result.failure instanceof MemoryDocumentConflict
        )
      ).toBe(true);
      const winner = winners[0];

      if (!winner) return yield* Effect.fail(new Error("Missing winner"));
      expect(winner.success.version).not.toBe(first.version);
      expect(yield* documents.read(key)).toEqual(winner.success);

      const stale = yield* documents
        .write({
          key,
          content: "must not replace",
          expectedVersion: first.version,
        })
        .pipe(Effect.flip);

      expect(stale).toMatchObject({ key });
      expect(stale).toBeInstanceOf(MemoryDocumentConflict);
      expect(stale).not.toHaveProperty("content");
      expect(
        yield* documents
          .write({
            key: `${prefix}absent`,
            content: "must not create",
            expectedVersion: randomUUID(),
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(MemoryDocumentConflict);
      expect(yield* documents.read(`${prefix}absent`)).toBeNull();
      expect(
        yield* documents
          .write({ key, content: "create again", expectedVersion: null })
          .pipe(Effect.flip)
      ).toBeInstanceOf(MemoryDocumentConflict);
      expect(yield* documents.read(key)).toEqual(winner.success);
    })
  ));

test("forgetting persists empty content with a new version across a second service connection", () =>
  run(
    Effect.fn("run.4")(function* (documents, sql, prefix) {
      const key = `${prefix}forget`;

      const first = yield* documents.write({
        key,
        content: "to forget",
        expectedVersion: null,
      });

      const empty = yield* documents.write({
        key,
        content: "",
        expectedVersion: first.version,
      });

      expect(empty.content).toBe("");
      expect(empty.version).not.toBe(first.version);
      expect(yield* documents.read(key)).toEqual(empty);

      const originalConnection = yield* sql<{
        pid: number;
      }>`SELECT pg_backend_pid() AS pid`;

      const restored = yield* Effect.gen(function* () {
        const freshSql = yield* PgClient.PgClient;
        const fresh = yield* MemoryDocuments;

        const connection = yield* freshSql<{
          pid: number;
          name: string;
        }>`SELECT pg_backend_pid() AS pid, current_database() AS name`;

        expect(connection[0]?.name).toBe("companion_runtime_test");
        expect(connection[0]?.pid).not.toBe(originalConnection[0]?.pid);

        return yield* fresh.read(key);
      }).pipe(
        Effect.provide(
          MemoryDocuments.layer.pipe(
            Layer.provideMerge(PgClient.layerConfig(databaseConfig))
          )
        )
      );

      expect(restored).toEqual(empty);
    })
  ));

test("invalid key, oversized content and invalid expected version are typed failures", () =>
  run(
    Effect.fn("run.5")(function* (documents, sql, prefix) {
      const valid = {
        key: `${prefix}invalid`,
        content: "bounded",
        expectedVersion: null,
      };

      const invalid = [
        { ...valid, key: "" },
        { ...valid, key: " padded " },
        { ...valid, key: "x".repeat(513) },
        { ...valid, content: "x".repeat(4001) },
        { ...valid, expectedVersion: "not-a-uuid" },
      ];

      const errors = yield* Effect.all(
        invalid.map((input) => documents.write(input).pipe(Effect.flip))
      );

      expect(
        errors.every((error) => error instanceof MemoryDocumentInvalidInput)
      ).toBe(true);
      expect(yield* documents.read(" ").pipe(Effect.flip)).toBeInstanceOf(
        MemoryDocumentInvalidInput
      );

      const rows =
        yield* sql`SELECT key FROM memory_document WHERE key = ${valid.key}`;

      expect(rows).toHaveLength(0);

      const boundary = yield* documents.write({
        key: `${prefix}${"x".repeat(512 - prefix.length)}`,
        content: "x".repeat(4000),
        expectedVersion: null,
      });

      expect(boundary.content).toHaveLength(4000);
    })
  ));

test("real SQL failures stay typed and never become missing documents", () =>
  run((documents, sql, prefix) =>
    sql.withTransaction(
      Effect.gen(function* () {
        // Hide public tables only for this real transaction; no schema or permissions change.
        yield* sql`SET LOCAL search_path TO pg_catalog`;

        const error = yield* documents
          .read(`${prefix}unavailable`)
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(MemoryDocumentStorageError);
        expect(error).not.toHaveProperty("cause");
        expect(error).not.toHaveProperty("content");
      })
    )
  ));
