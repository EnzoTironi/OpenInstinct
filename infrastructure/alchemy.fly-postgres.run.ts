import * as Alchemy from "alchemy";
import * as Fly from "alchemy/Fly";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Config, Effect, Option } from "effect";
import { CompanionStagePolicy } from "./companion-stage.ts";

/**
 * Companion Alchemy **unmanaged** Postgres on Fly (H01 option C).
 *
 * Uses {@link Fly.App} + {@link Fly.Machine} (`postgres:17-alpine`) + a
 * volume mount. This is **not** Fly Managed Postgres and **not**
 * Alchemy `Fly.Postgres` (MPG). Stage database names still come from
 * {@link CompanionStagePolicy} (`open_instinct_<stage>`).
 *
 * Reachability: Fly private network only (no public proxy services).
 * companion-tironi (same org) uses
 * `postgresql://postgres:<password>@<appName>.internal:5432/<database>?sslmode=disable`.
 *
 * Never log or return secret values — only stage metadata, app/machine
 * names, and URL *shapes* with placeholders.
 */
export default Alchemy.Stack(
  "CompanionFlyPostgres",
  {
    providers: Fly.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const policy = yield* CompanionStagePolicy;
    const password = yield* Config.redacted("COMPANION_POSTGRES_PASSWORD");
    const region = yield* Config.string("COMPANION_FLY_PG_REGION").pipe(
      Config.withDefault("gru")
    );
    const volumeSizeGb = yield* Config.number(
      "COMPANION_FLY_PG_VOLUME_GB"
    ).pipe(
      Config.withDefault(10),
      Config.map((n) => Math.max(1, Math.floor(n)))
    );
    const configuredAppName = yield* Config.string(
      "COMPANION_FLY_PG_APP_NAME"
    ).pipe(Config.option);
    const appName = Option.getOrElse(
      configuredAppName,
      () => `companion-pg-${policy.stage.replaceAll("_", "-")}`
    );

    const app = yield* Fly.App("PostgresApp", {
      name: appName,
    });

    // Injected as Machine env POSTGRES_PASSWORD (never stored in attributes).
    yield* Fly.Secret("PostgresPassword", {
      app,
      name: "POSTGRES_PASSWORD",
      value: password,
    });

    const machine = yield* Fly.Machine("Postgres", {
      app,
      name: "postgres",
      region,
      image: "postgres:17-alpine",
      guest: { cpuKind: "shared", cpus: 1, memoryMb: 1024 },
      env: {
        POSTGRES_DB: policy.database,
        POSTGRES_USER: "postgres",
        // Subdir avoids ext4 lost+found conflicts on a fresh Fly volume.
        PGDATA: "/data/pgdata",
      },
      mounts: [
        {
          path: "/data",
          sizeGb: volumeSizeGb,
          encrypted: true,
          autoBackupEnabled: true,
          name: "pgdata",
        },
      ],
      // Omit public proxy — 6PN / .internal only (not MPG, not fly.dev PG).
      services: [],
      restart: { policy: "always" },
      metadata: {
        role: "companion-unmanaged-postgres",
        "companion.stage": policy.stage,
        "companion.database": policy.database,
      },
    }).pipe(RemovalPolicy.retain(policy.retainPostgresData));

    const internalHost = `${app.appName}.internal`;
    const urlShape = `postgresql://postgres:<url-encoded-password>@${internalHost}:5432/${policy.database}?sslmode=disable`;

    return {
      provider: "fly-machine-unmanaged-postgres",
      notMpg: true,
      stage: policy.stage,
      documented: policy.documented,
      tier: policy.tier,
      database: policy.database,
      envFileHint: policy.envFileHint,
      retainPostgresData: policy.retainPostgresData,
      appName: app.appName,
      region,
      machineId: machine.machineId,
      machineState: machine.state,
      privateIp: machine.privateIp,
      volumeSizeGb,
      internalHost,
      internalPort: 5432,
      databaseUrlShape: urlShape,
      databaseUrlUnpooledShape: urlShape,
    };
  }).pipe(Effect.provide(CompanionStagePolicy.layer))
);
