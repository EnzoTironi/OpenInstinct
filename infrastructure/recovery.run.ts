import * as Alchemy from "alchemy";
import { Action } from "alchemy/Action";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Fly from "alchemy/Fly";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { Config, Effect, Layer, Schedule, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { production } from "./production.ts";

const retryCleanup = { times: 5, schedule: Schedule.exponential("1 second") };
const proofSchema = Schema.Struct({
  ok: Schema.Literal(true),
  amcheck: Schema.Literal("passed"),
  postgres_version: Schema.String,
});

const RestoreProof = Action(
  "Zoen.RestoreProof",
  (input: { run: string; target?: string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!/^[a-z0-9-]{1,40}$/.test(input.run))
          return yield* Effect.fail(
            new Error("Recovery run must be a short lowercase identifier")
          );
        const app = production.database.app;
        const primary = yield* Machines.getMachine({
          app_name: app,
          machine_id: production.database.machine,
        });
        const image = primary.config?.image;
        if (!image?.includes("@sha256:"))
          return yield* Effect.fail(
            new Error(
              "Recovery requires the immutable production PostgreSQL image"
            )
          );
        const volume = yield* Effect.acquireRelease(
          Machines.createVolume({
            app_name: app,
            name: `recovery_${input.run.replaceAll("-", "_")}`,
            region: production.region,
            size_gb: 10,
            encrypted: true,
            auto_backup_enabled: false,
          }),
          (disk) =>
            disk.id
              ? Machines.deleteVolume({
                  app_name: app,
                  volume_id: disk.id,
                }).pipe(Effect.retry(retryCleanup), Effect.orDie)
              : Effect.void
        );
        if (!volume.id || volume.id === production.database.volume)
          return yield* Effect.fail(
            new Error("Recovery volume identity is invalid")
          );
        const environment = {
          PGDATA: "/data/pgdata",
          POSTGRES_DB: "open_instinct_prod",
          POSTGRES_USER: "postgres",
          ZOEN_RESTORE_PROOF: "1",
          ZOEN_RESTORE_FROM_BACKUP: "1",
          ZOEN_RECOVERY_ISOLATED: "true",
          ZOEN_RECOVERY_HOLD: "1",
          ZOEN_RESTORE_TARGET: input.target ?? "",
        };
        const machine = yield* Effect.acquireRelease(
          Machines.createMachine({
            app_name: app,
            name: `recovery-${input.run}`,
            region: production.region,
            skip_service_registration: true,
            config: {
              image,
              guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
              mounts: [{ path: "/data", volume: volume.id }],
              dns: { skip_registration: true },
              services: [],
              restart: { policy: "no" },
              env: environment,
              metadata: {
                "zoen.role": "isolated-recovery",
                "zoen.recovery-run": input.run,
              },
            },
          }),
          (created) =>
            created.id
              ? Machines.deleteMachine({
                  app_name: app,
                  machine_id: created.id,
                  force: true,
                }).pipe(Effect.retry(retryCleanup), Effect.orDie)
              : Effect.void
        );
        if (!machine.id || machine.id === production.database.machine)
          return yield* Effect.fail(
            new Error("Recovery machine identity is invalid")
          );
        const machineId = machine.id;
        yield* Machines.waitMachine({
          app_name: app,
          machine_id: machineId,
          state: "started",
          timeout: 60,
        });
        for (let attempt = 0; attempt < 90; attempt++) {
          const result = yield* Machines.execMachine({
            app_name: app,
            machine_id: machineId,
            command: [
              "sh",
              "-c",
              "test -s /tmp/zoen-restore-proof.json && cat /tmp/zoen-restore-proof.json",
            ],
            timeout: 10,
          });
          if (result.exit_code === 0) {
            const proof = yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(proofSchema)
            )(result.stdout ?? "");
            return {
              run: input.run,
              ok: true,
              amcheck: proof.amcheck,
              postgresVersion: proof.postgres_version,
              sourceImage: image,
            };
          }
          yield* Effect.sleep("5 seconds");
        }
        return yield* Effect.fail(
          new Error(
            "Recovery did not pass integrity verification within 8 minutes"
          )
        );
      })
    ).pipe(
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);

export default Alchemy.Stack(
  "ZoenRecovery",
  {
    providers: Layer.mergeAll(Fly.providers(), Cloudflare.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const run = yield* Config.string("ZOEN_RECOVERY_RUN");
    const target = yield* Config.string("ZOEN_RESTORE_TARGET").pipe(
      Config.withDefault("")
    );
    return yield* RestoreProof({ run, target: target || undefined });
  })
);
