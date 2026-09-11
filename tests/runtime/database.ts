import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Schema } from "effect";

class RuntimeDatabaseRequired extends Schema.TaggedError<RuntimeDatabaseRequired>()(
  "RuntimeDatabaseRequired",
  {}
) {}

const database = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(8),
});

export const runtimeDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;

    const rows = yield* sql<{
      name: string;
    }>`SELECT current_database() AS name`;

    if (rows[0]?.name !== "companion_runtime_test") {
      return yield* new RuntimeDatabaseRequired();
    }

    return undefined;
  })
).pipe(Layer.provideMerge(database));
