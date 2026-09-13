import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, Redacted } from "effect";
import { migrateApplication } from "../server/database/migrations.ts";

Effect.gen(function* () {
  const direct = yield* Config.redacted("DATABASE_URL_UNPOOLED").pipe(
    Config.withDefault(Redacted.make(""))
  );
  const url =
    Redacted.value(direct) ||
    (yield* Effect.gen(function* () {
      const host = yield* Config.string("ZOEN_DATABASE_HOST");
      const database = yield* Config.string("POSTGRES_DB");
      const password = yield* Config.redacted(
        "ZOEN_MIGRATION_DATABASE_PASSWORD"
      );
      return `postgresql://zoen_migrator:${encodeURIComponent(Redacted.value(password))}@${host}:5432/${encodeURIComponent(database)}`;
    }));
  const result = yield* migrateApplication(url);
  yield* Effect.logInfo("Database migrations verified", result);
}).pipe(
  Effect.timeout("10 minutes"),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
