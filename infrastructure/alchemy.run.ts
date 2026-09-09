import * as Alchemy from "alchemy";
import * as Docker from "alchemy/Docker";
import * as Provider from "alchemy/Provider";
import { Stack } from "alchemy/Stack";
import { Config, Effect, Layer } from "effect";

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
 * Alchemy stages already isolate stack state and Docker physical names
 * (container + volume) per `--stage`. This program additionally derives a
 * Postgres database name from the stage so app env files can target
 * `open_instinct_<stage>` explicitly.
 */
export default Alchemy.Stack(
  "CompanionLocal",
  {
    providers,
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const stack = yield* Stack;
    const stage = stack.stage;
    const database = `open_instinct_${stage.replaceAll("-", "_")}`;
    const password = yield* Config.redacted("COMPANION_POSTGRES_PASSWORD");
    const image = yield* Docker.RemoteImage("PostgresImage", {
      name: "postgres",
      tag: "17-alpine",
      alwaysPull: false,
    });
    const data = yield* Docker.Volume("PostgresData", {});
    const postgres = yield* Docker.Container("Postgres", {
      image,
      environment: {
        POSTGRES_DB: database,
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: password,
      },
      ports: [{ external: "127.0.0.1:", internal: 5432 }],
      volumes: [
        { hostPath: data.name, containerPath: "/var/lib/postgresql/data" },
      ],
      healthcheck: {
        cmd: `pg_isready -U postgres -d ${database}`,
        interval: "2 seconds",
        timeout: "5 seconds",
        retries: 10,
      },
      start: true,
    });
    return {
      stage,
      database,
      container: postgres.name,
      ports: postgres.ports,
      volume: data.name,
    };
  })
);
