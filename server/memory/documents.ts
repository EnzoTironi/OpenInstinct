import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";

const keySchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isTrimmed()
);
const contentSchema = Schema.String.check(Schema.isMaxLength(4000));
const versionSchema = Schema.String.check(Schema.isUUID());
export const MemoryDocumentSchema = Schema.Struct({
  content: contentSchema,
  version: versionSchema,
});
const writeInput = Schema.Struct({
  key: keySchema,
  content: contentSchema,
  expectedVersion: Schema.NullOr(versionSchema),
});

export class MemoryDocumentConflict extends Schema.TaggedError<MemoryDocumentConflict>()(
  "MemoryDocumentConflict",
  { key: keySchema }
) {}
export class MemoryDocumentInvalidInput extends Schema.TaggedError<MemoryDocumentInvalidInput>()(
  "MemoryDocumentInvalidInput",
  {}
) {}
export class MemoryDocumentStorageError extends Schema.TaggedError<MemoryDocumentStorageError>()(
  "MemoryDocumentStorageError",
  {}
) {}
const invalidInput = () => new MemoryDocumentInvalidInput();
const storageError = () => new MemoryDocumentStorageError();
const decodeDocument = Schema.decodeUnknownEffect(MemoryDocumentSchema);

const makeDocuments = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return {
    read: Effect.fn("MemoryDocuments.read")(
      function* (key: string) {
        const valid = yield* Schema.decodeUnknownEffect(keySchema)(key).pipe(
          Effect.mapError(invalidInput)
        );
        const rows =
          yield* sql`SELECT content, version FROM memory_document WHERE key = ${valid}`;
        if (!rows[0]) return null;
        return yield* decodeDocument(rows[0]).pipe(
          Effect.mapError(storageError)
        );
      },
      Effect.catchTag("SqlError", storageError)
    ),
    write: Effect.fn("MemoryDocuments.write")(
      function* (input: typeof writeInput.Type) {
        const value = yield* Schema.decodeUnknownEffect(writeInput, {
          onExcessProperty: "error",
        })(input).pipe(Effect.mapError(invalidInput));
        const version = randomUUID();
        const rows =
          value.expectedVersion === null
            ? yield* sql`INSERT INTO memory_document (key, content, version)
            VALUES (${value.key}, ${value.content}, ${version})
            ON CONFLICT (key) DO NOTHING RETURNING content, version`
            : yield* sql`UPDATE memory_document SET content = ${value.content}, version = ${version}, updated_at = clock_timestamp()
            WHERE key = ${value.key} AND version = ${value.expectedVersion}
            RETURNING content, version`;
        if (!rows[0])
          return yield* new MemoryDocumentConflict({ key: value.key });
        return yield* decodeDocument(rows[0]).pipe(
          Effect.mapError(storageError)
        );
      },
      Effect.catchTag("SqlError", storageError)
    ),
  };
});

export class MemoryDocuments extends Context.Service<
  MemoryDocuments,
  Effect.Success<typeof makeDocuments>
>()("companion/server/memory/MemoryDocuments") {
  static readonly layer = Layer.effect(MemoryDocuments, makeDocuments);
}
