import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { production } from "./production.ts";

const databaseCheck = Effect.gen(function* () {
  const machine = yield* Machines.getMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
  });
  if (
    machine.state !== "started" ||
    machine.config?.mounts?.[0]?.volume !== production.database.volume
  ) {
    return yield* Effect.fail(
      new Error(
        "Production PostgreSQL machine or volume does not match its declared identity"
      )
    );
  }
  const check = yield* Machines.execMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
    command: ["/usr/local/bin/backup-health.sh"],
    timeout: 60,
  });
  if (check.exit_code !== 0)
    return yield* Effect.fail(
      new Error("PostgreSQL backup or WAL archive health check failed")
    );
  yield* Effect.log(check.stdout ?? "Backup check passed");
  // Probe the private memory endpoint from the database network using the
  // same app-scoped operations token; it needs no user or memory credentials.
  const memory = yield* Machines.execMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
    command: [
      "wget",
      "-q",
      "-T",
      "15",
      "-O",
      "-",
      `http://${production.memory.app}.internal:8000/health`,
    ],
    timeout: 20,
  });
  if (memory.exit_code !== 0)
    return yield* Effect.fail(new Error("Private memory health check failed"));
  const health = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        ok: Schema.Literal(true),
        backend: Schema.Literal("mem0-pgvector"),
      })
    )
  )(memory.stdout ?? "");
  return yield* Effect.log(health);
});

const main = Effect.gen(function* () {
  const command = process.argv[2];
  if (command !== "check")
    return yield* Effect.fail(new Error("Usage: node operations.ts check"));
  return yield* databaseCheck;
}).pipe(
  Effect.provide(CredentialsFromEnv),
  Effect.provide(FetchHttpClient.layer)
);

NodeRuntime.runMain(main);
