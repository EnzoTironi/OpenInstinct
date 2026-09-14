import { Action } from "alchemy/Action";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { Effect, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

interface WebCutover {
  app: string;
  replacement: string;
  legacy: string;
  release: string;
  volume: string;
}

export const retireLegacyWeb = Effect.fn("retireLegacyWeb")(function* (
  input: WebCutover
) {
  if (input.replacement === input.legacy)
    return yield* Effect.fail(new Error("Web cutover requires a new machine"));

  // Fly volumes are tied to a physical host. The replacement must have its
  // persistent volume and pass its own readiness check before removing traffic.
  yield* Effect.gen(function* () {
    const machine = yield* Machines.getMachine({
      app_name: input.app,
      machine_id: input.replacement,
    });
    if (
      machine.state !== "started" ||
      machine.config?.metadata?.["zoen.migrated-image"] !== input.release ||
      !machine.config.mounts?.some(
        (mount) =>
          mount.path === "/root/.eve/auth" && mount.volume === input.volume
      ) ||
      !machine.checks?.some(
        (check) => check.name === "alive" && check.status === "passing"
      )
    )
      return yield* Effect.fail(new Error("Replacement web is not ready"));
    return undefined;
  }).pipe(Effect.retry({ times: 24, schedule: Schedule.spaced("5 seconds") }));

  const legacy = yield* Machines.getMachine({
    app_name: input.app,
    machine_id: input.legacy,
  });
  if (!legacy.config || !legacy.instance_id)
    return yield* Effect.fail(
      new Error("Legacy web configuration unavailable")
    );

  // Stopping alone lets Fly Proxy auto-start the old release. Remove its public
  // services and restart policy first; retain the machine for explicit rollback.
  if (
    legacy.config.services?.length ||
    legacy.config.restart?.policy !== "no"
  ) {
    yield* Machines.updateMachine({
      app_name: input.app,
      machine_id: input.legacy,
      current_version: legacy.instance_id,
      skip_launch: true,
      config: Object.assign({}, legacy.config, {
        services: [],
        restart: { policy: "no" },
      }),
    });
  }
  const current = yield* Machines.getMachine({
    app_name: input.app,
    machine_id: input.legacy,
  });
  if (!["stopped", "suspended", "created"].includes(current.state ?? "")) {
    yield* Machines.stopMachine({
      app_name: input.app,
      machine_id: input.legacy,
      signal: "SIGTERM",
      timeout: "30s",
    });
    yield* Machines.waitMachine({
      app_name: input.app,
      machine_id: input.legacy,
      state: "stopped",
      timeout: 60,
    });
  }
  return { machine: input.replacement, release: input.release };
});

export const RetireLegacyWeb = Action(
  "Zoen.RetireLegacyWeb",
  (input: WebCutover) =>
    retireLegacyWeb(input).pipe(
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);
