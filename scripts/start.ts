import { fileURLToPath } from "node:url";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Schedule, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

class ServerStopped extends Schema.TaggedError<ServerStopped>()(
  "ServerStopped",
  {
    message: Schema.String,
  }
) {}

const start = Command.make(
  "start",
  {
    port: Flag.integer("port").pipe(
      Flag.withSchema(Config.Port),
      Flag.withFallbackConfig(Config.port("PORT")),
      Flag.withDefault(3000)
    ),
    hostname: Flag.string("hostname").pipe(Flag.withDefault("127.0.0.1")),
    evePort: Flag.integer("eve-port").pipe(
      Flag.withSchema(Config.Port),
      Flag.withFallbackConfig(Config.port("EVE_NEXT_PRODUCTION_PORT")),
      Flag.withDefault(4274)
    ),
  },
  Effect.fn("startCompanion")(function* ({ evePort, hostname, port }) {
    if (port === evePort) {
      return yield* new ServerStopped({
        message:
          "Web and Eve ports must differ. Use --port 3000 --eve-port 4274.",
      });
    }

    const fs = yield* FileSystem.FileSystem;

    const routes = yield* fs.readFileString(".next/routes-manifest.json").pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(
            Schema.Struct({
              rewrites: Schema.Struct({
                beforeFiles: Schema.Array(
                  Schema.Struct({
                    source: Schema.String,
                    destination: Schema.String,
                  })
                ),
              }),
            })
          )
        )
      )
    );

    const origin = `http://127.0.0.1:${String(evePort)}`;

    const requiredRoutes = [
      ["/eve/v1/:path+", "/eve/v1/:path+"],
      ["/api/channels/telegram", "/channels/telegram"],
      ["/api/channels/kapso", "/channels/kapso"],
    ] as const;

    if (
      !requiredRoutes.every(([source, path]) =>
        routes.rewrites.beforeFiles.some(
          (route) =>
            route.source === source && route.destination === `${origin}${path}`
        )
      )
    ) {
      return yield* new ServerStopped({
        message:
          "Eve port does not match the built web routes. Rebuild with EVE_NEXT_PRODUCTION_PORT set to the desired port.",
      });
    }

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const capacity = Schema.Int.check(Schema.isGreaterThan(0));

    const concurrency = yield* Config.schema(
      capacity,
      "WORKFLOW_POSTGRES_WORKER_CONCURRENCY"
    ).pipe(Config.withDefault(4));

    const poolSize = yield* Config.schema(
      capacity,
      "WORKFLOW_POSTGRES_MAX_POOL_SIZE"
    ).pipe(Config.withDefault(10));

    const eve = yield* spawner.spawn(
      ChildProcess.make(process.execPath, [".output/server/index.mjs"], {
        env: {
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          NITRO_HOST: "127.0.0.1",
          NITRO_PORT: String(evePort),
          PORT: String(evePort),
          WORKFLOW_LOCAL_BASE_URL: `http://127.0.0.1:${String(evePort)}`,
          WORKFLOW_POSTGRES_WORKER_CONCURRENCY: String(concurrency),
          WORKFLOW_POSTGRES_MAX_POOL_SIZE: String(poolSize),
        },
        extendEnv: true,
        stdout: "inherit",
        stderr: "inherit",
        forceKillAfter: "15 seconds",
      })
    );

    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    yield* Effect.raceFirst(
      http
        .get(`http://127.0.0.1:${String(evePort)}/eve/v1/health`)
        .pipe(
          Effect.retry(Schedule.spaced("100 millis")),
          Effect.timeout("30 seconds")
        ),
      eve.exitCode.pipe(
        Effect.flatMap(
          (code) =>
            new ServerStopped({
              message: `Eve exited before readiness with code ${String(code)}.`,
            })
        )
      )
    );

    const web = yield* spawner.spawn(
      ChildProcess.make(
        process.execPath,
        [
          fileURLToPath(import.meta.resolve("next/dist/bin/next")),
          "start",
          "--hostname",
          hostname,
          "--port",
          String(port),
        ],
        {
          env: {
            NODE_ENV: "production",
            EVE_NEXT_PRODUCTION_PORT: String(evePort),
          },
          extendEnv: true,
          stdout: "inherit",
          stderr: "inherit",
          forceKillAfter: "15 seconds",
        }
      )
    );

    const code = yield* Effect.raceFirst(eve.exitCode, web.exitCode);

    return yield* new ServerStopped({
      message: `A server exited with code ${String(code)}; stopping the companion.`,
    });
  }, Effect.scoped)
).pipe(
  Command.withDescription(
    "Run the built companion web app and Eve runtime together."
  ),
  Command.withExamples([
    {
      command: "pnpm start --port 3000",
      description: "Start locally after migrations and pnpm build.",
    },
    {
      command: "pnpm start --hostname 0.0.0.0",
      description: "Expose the web app; Eve stays on loopback.",
    },
  ])
);

start.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
