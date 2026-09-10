import * as Alchemy from "alchemy";
import * as Docker from "alchemy/Docker";
import * as Provider from "alchemy/Provider";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Config, Effect, Layer } from "effect";
import { CompanionStagePolicy } from "./companion-stage";

const providers = Layer.effect(
  Docker.Providers,
  Provider.collection([Docker.Container, Docker.RemoteImage, Docker.Volume])
).pipe(
  Layer.provide(
    Layer.mergeAll(
      Docker.ContainerProvider(),
      Docker.RemoteImageProvider(),
      Docker.VolumeProvider()
    )
  ),
  Layer.provideMerge(Docker.DockerLive)
);

/**
 * Companion Alchemy Postgres composition for documented stages
 * (`local` → `dev` → `staging` → `prod`).
 *
 * Alchemy already isolates stack state and Docker physical names per
 * `--stage`. {@link CompanionStagePolicy} adds Effect-layer stage policy:
 * database name, env-file hint, tier, and prod-only volume retain on destroy.
 * Staging and prod use the same resource graph with different policy.
 *
 * Never log or return secret values — only stage metadata and resource names.
 */
export default Alchemy.Stack(
  "CompanionLocal",
  {
    providers,
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const policy = yield* CompanionStagePolicy;
    const password = yield* Config.redacted("COMPANION_POSTGRES_PASSWORD");
    const image = yield* Docker.RemoteImage("PostgresImage", {
      name: "postgres",
      tag: "17-alpine",
      alwaysPull: false,
    });
    const data = yield* Docker.Volume("PostgresData", {}).pipe(
      RemovalPolicy.retain(policy.retainPostgresData)
    );
    const postgres = yield* Docker.Container("Postgres", {
      image,
      environment: {
        POSTGRES_DB: policy.database,
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: password,
      },
      ports: [{ external: "127.0.0.1:", internal: 5432 }],
      volumes: [
        { hostPath: data.name, containerPath: "/var/lib/postgresql/data" },
      ],
      healthcheck: {
        cmd: `pg_isready -U postgres -d ${policy.database}`,
        interval: "2 seconds",
        timeout: "5 seconds",
        retries: 10,
      },
      start: true,
    });
    return {
      stage: policy.stage,
      documented: policy.documented,
      tier: policy.tier,
      database: policy.database,
      envFileHint: policy.envFileHint,
      retainPostgresData: policy.retainPostgresData,
      container: postgres.name,
      ports: postgres.ports,
      volume: data.name,
    };
  }).pipe(Effect.provide(CompanionStagePolicy.layer))
);
