import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import { retain } from "alchemy/RemovalPolicy";
import { Effect } from "effect";
import { releaseImage } from "./images.ts";
import { PrepareMatrixDatabase } from "./database.ts";
import { production } from "./production.ts";

export const provisionMatrix = Effect.fn("provisionMatrix")(function* (input: {
  stage: string;
  organization: string;
  region: string;
  postgresApp: Fly.App;
  webApp: Fly.App;
}) {
  const name =
    input.stage === "prod"
      ? production.matrix.app
      : `zoen-matrix-${input.stage}`;
  const app = yield* Fly.App("MatrixApp", {
    name,
    orgSlug: input.organization,
  }).pipe(retain(true));
  const secrets = yield* Effect.forEach(
    ["DATABASE_PASSWORD", "AS_TOKEN", "HS_TOKEN", "SIGNING_SECRET"],
    (key) =>
      Effect.gen(function* () {
        const random = yield* Random(`Matrix${key}`, { bytes: 32 }).pipe(
          retain(true)
        );
        const matrix = yield* Fly.Secret(`Matrix${key}Secret`, {
          app,
          name: `ZOEN_MATRIX_${key}`,
          value: random.text,
        }).pipe(retain(true));
        const peer =
          key === "DATABASE_PASSWORD"
            ? yield* Fly.Secret("MatrixPostgresPassword", {
                app: input.postgresApp,
                name: `ZOEN_MATRIX_${key}`,
                value: random.text,
              }).pipe(retain(true))
            : key === "AS_TOKEN" || key === "HS_TOKEN"
              ? yield* Fly.Secret(`WebMatrix${key}`, {
                  app: input.webApp,
                  name: `ZOEN_MATRIX_${key}`,
                  value: random.text,
                }).pipe(retain(true))
              : undefined;
        return {
          key,
          matrix: matrix.digest,
          peer: peer?.digest ?? Output.literal(undefined),
        };
      })
  );
  return {
    app,
    name,
    databaseVersion: Output.all(
      ...secrets.filter((s) => s.key === "DATABASE_PASSWORD").map((s) => s.peer)
    ).pipe(Output.map((values) => JSON.stringify(values))),
    webVersion: Output.all(
      ...secrets
        .filter((s) => s.key === "AS_TOKEN" || s.key === "HS_TOKEN")
        .map((s) => s.peer)
    ).pipe(Output.map((values) => JSON.stringify(values))),
    version: Output.all(...secrets.map((s) => s.matrix)).pipe(
      Output.map((values) => JSON.stringify(values))
    ),
  };
});

export const deployMatrix = Effect.fn("deployMatrix")(function* (input: {
  provision: Effect.Success<ReturnType<typeof provisionMatrix>>;
  postgresApp: string;
  postgresMachine: Output.Output<string>;
  postgresImage: Output.Output<string>;
  webApp: string;
  serverName: string;
  region: string;
}) {
  const database = yield* PrepareMatrixDatabase({
    app: input.postgresApp,
    machine: input.postgresMachine,
    release: input.postgresImage,
    credentialVersion: input.provision.databaseVersion,
  });
  const image = yield* releaseImage("Matrix", input.provision.name, "./matrix");
  return yield* Fly.Machine("Matrix", {
    app: input.provision.app,
    name: "matrix",
    region: input.region,
    count: 1,
    image,
    guest: { cpuKind: "shared", cpus: 1, memoryMb: 1024 },
    env: {
      ZOEN_MATRIX_SERVER_NAME: input.serverName,
      ZOEN_DATABASE_HOST: `${input.postgresApp}.internal`,
      ZOEN_MATRIX_CALLBACK_URL: `http://${input.webApp}.internal:3000`,
    },
    services: [],
    restart: { policy: "always" },
    checks: {
      health: {
        type: "http",
        port: 8008,
        method: "GET",
        path: "/health",
        interval: "30s",
        timeout: "5s",
        grace_period: "2m0s",
      },
    },
    metadata: {
      "zoen.secrets": input.provision.version,
      "zoen.database-ready": database.release,
    },
  }).pipe(retain(true));
});
