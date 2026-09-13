import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { Mem0 } from "./mem0";

/** A DB trigger retains these non-content receipts after an account/workspace is deleted. */
export const drainMemoryErasures = Effect.fn("drainMemoryErasures")(
  function* () {
    const sql = yield* PgClient.PgClient;
    const mem0 = yield* Mem0;
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
            yield* mem0.mutate({
              namespace: id,
              action: "clear",
              operation_id: `erasure:${id}`,
            });
            yield* sql`DELETE FROM workspace_memory_erasure WHERE namespace_id = ${id}`;
          })
        );
        return { cleared: rows.length };
      })
    );
  }
);
