import { NodeRuntime } from "@effect/platform-node";
import { Config, Effect, Layer } from "effect";
import { PgClient } from "@effect/sql-pg";
import { applyAccountDeletionTombstones } from "../server/accounts/deletion";
import { ErasureJournal } from "../server/accounts/erasure-journal";

applyAccountDeletionTombstones().pipe(
  Effect.tap(({ applied }) =>
    Effect.logInfo("Account erasures reconciled before startup", { applied })
  ),
  Effect.provide(
    Layer.mergeAll(
      ErasureJournal.layer,
      PgClient.layerConfig({
        url: Config.redacted("DATABASE_URL"),
        maxConnections: Config.succeed(1),
      })
    )
  ),
  NodeRuntime.runMain
);
