import { Action } from "alchemy/Action";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { Effect, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

export const PrepareMemoryDatabase = Action(
  "Zoen.PrepareMemoryDatabase",
  (input: {
    app: string;
    machine: string;
    release: string;
    credentialVersion: string | undefined;
  }) =>
    Effect.gen(function* () {
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
        return yield* Effect.void;
      }).pipe(
        Effect.retry({ times: 12, schedule: Schedule.spaced("5 seconds") })
      );
      const result = yield* Machines.execMachine({
        app_name: input.app,
        machine_id: input.machine,
        command: ["/usr/local/bin/bootstrap-memory.sh"],
        timeout: 60,
      });
      if (result.exit_code !== 0)
        return yield* Effect.fail(
          new Error("Memory database bootstrap failed")
        );
      return {
        database: "zoen_memory",
        role: "zoen_memory",
        release: input.release,
      };
    }).pipe(
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);
