import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { learnedNoteTypeId } from "./learned-type";

/** A DB trigger retains these non-content receipts after an account/workspace is deleted. */
export const drainMemoryErasures = Effect.fn("drainMemoryErasures")(
  function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const queued =
          yield* sql`SELECT namespace_id AS id FROM workspace_memory_erasure ORDER BY requested_at LIMIT 5 FOR UPDATE SKIP LOCKED`;
        const rows = yield* Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ id: Schema.String.check(Schema.isUUID()) })
          )
        )(queued);
        yield* Effect.forEach(
          rows,
          Effect.fn(function* ({ id }) {
            yield* sql`DELETE FROM workspace_learned_item
              WHERE namespace_id = ${id} AND type_id = ${learnedNoteTypeId}`;
            yield* sql`DELETE FROM workspace_memory_erasure WHERE namespace_id = ${id}`;
          })
        );
        return { cleared: rows.length };
      })
    );
  }
);
