import { Effect } from "effect";
import {
  MemoryDocumentConflictError,
  type MemoryDocumentBackend,
} from "eve/memory/file";
import { MemoryDocuments } from "../../server/memory/documents";
import { serverRuntime } from "../../server/runtime";

export const memoryDocumentBackend: MemoryDocumentBackend = {
  read: ({ key, signal }) =>
    serverRuntime.runPromise(
      Effect.flatMap(MemoryDocuments, (documents) => documents.read(key)),
      { signal }
    ),
  write: ({ key, content, expectedVersion, signal }) =>
    serverRuntime.runPromise(
      Effect.flatMap(MemoryDocuments, (documents) =>
        documents.write({ key, content, expectedVersion })
      ).pipe(
        Effect.catchTag("MemoryDocumentConflict", (error) =>
          Effect.fail(new MemoryDocumentConflictError(error.key))
        )
      ),
      { signal }
    ),
};
