import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Schema } from "effect";

import { disposableDatabaseNames } from "../../server/database/reset-target";

class RuntimeDatabaseRequired extends Schema.TaggedError<RuntimeDatabaseRequired>()(
  "RuntimeDatabaseRequired",
  {}
) {}

const database = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(8),
});

const disposableNames = new Set<string>(disposableDatabaseNames);

export const runtimeDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql<{
      name: string;
    }>`SELECT current_database() AS name`;
    if (!rows[0] || !disposableNames.has(rows[0].name)) {
      return yield* new RuntimeDatabaseRequired();
    }
    return undefined;
  })
).pipe(Layer.provideMerge(database));
