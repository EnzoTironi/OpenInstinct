import { Action } from "alchemy/Action";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { Effect, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

interface DatabasePreparation {
  app: string;
  machine: string;
  release: string;
  credentialVersion: string;
}

export const prepareServiceDatabases = Effect.fn("prepareServiceDatabases")(
  function* (input: DatabasePreparation) {
    // API 'started' precedes PostgreSQL readiness during an image update.
    yield* Effect.gen(function* () {
      const ready = yield* Machines.execMachine({
        app_name: input.app,
        machine_id: input.machine,
        command: ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
        timeout: 10,
      });
      if (ready.exit_code !== 0)
        return yield* Effect.fail(new Error("PostgreSQL is starting"));
      return undefined;
    }).pipe(
      Effect.retry({ times: 12, schedule: Schedule.spaced("5 seconds") })
    );

    // Separate Alchemy actions can run concurrently. These scripts touch shared
    // PostgreSQL catalogs and database ACLs, so they belong to one ordered action.
    for (const database of [
      "application",
      "memory",
      "matrix",
      "vaultwarden",
    ] as const) {
      const result = yield* Machines.execMachine({
        app_name: input.app,
        machine_id: input.machine,
        command: [`/usr/local/bin/bootstrap-${database}.sh`],
        timeout: 60,
      });
      if (result.exit_code !== 0)
        return yield* Effect.fail(
          new Error(`${database} database bootstrap failed`)
        );
    }
    return {
      release: input.release,
      credentialVersion: input.credentialVersion,
    };
  }
);

export const PrepareServiceDatabases = Action(
  "Zoen.PrepareServiceDatabases",
  (input: DatabasePreparation) =>
    prepareServiceDatabases(input).pipe(
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);
