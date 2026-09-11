import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import {
  MemoryDocumentConflictError,
  type MemoryDocumentBackend,
} from "eve/memory/file";

import { MemoryDocuments } from "../../server/memory/documents";
import { serverRuntime } from "../../server/runtime";
import type { authorizePersonalMemoryContext } from "./personal-memory-access";

export function createMemoryDocumentBackend(
  authorize: ReturnType<typeof authorizePersonalMemoryContext>
): MemoryDocumentBackend {
  return {
    read: ({ key, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;

          return yield* sql.withTransaction(
            Effect.andThen(
              authorize,
              Effect.flatMap(MemoryDocuments, (documents) =>
                documents.read(key)
              )
            )
          );
        }),
        { signal }
      ),
    write: ({ key, content, expectedVersion, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;

          return yield* sql.withTransaction(
            Effect.andThen(
              authorize,
              Effect.flatMap(MemoryDocuments, (documents) =>
                documents.write({ key, content, expectedVersion })
              )
            )
          );
        }).pipe(
          Effect.catchTag("MemoryDocumentConflict", (error) =>
            Effect.fail(new MemoryDocumentConflictError(error.key))
          )
        ),
        { signal }
      ),
  };
}
