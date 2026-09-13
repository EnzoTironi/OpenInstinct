import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
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
  return yield* Effect.log(check.stdout ?? "Backup check passed");
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
