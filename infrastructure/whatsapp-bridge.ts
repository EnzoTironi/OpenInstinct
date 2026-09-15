import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import { retain } from "alchemy/RemovalPolicy";
import { Effect } from "effect";
import { releaseImage } from "./images.ts";
import { production } from "./production.ts";

export const provisionWhatsAppBridge = Effect.fn("provisionWhatsAppBridge")(
  function* (input: {
    stage: string;
    organization: string;
    postgresApp: Fly.App;
    webApp: Fly.App;
    matrixApp: Fly.App;
  }) {
    const name =
      input.stage === "prod"
        ? production.whatsapp.app
        : `zoen-whatsapp-${input.stage}`;
    const app = yield* Fly.App("WhatsAppApp", {
      name,
      orgSlug: input.organization,
    }).pipe(retain(true));
    const secrets = yield* Effect.forEach(
      [
        "DATABASE_PASSWORD",
        "AS_TOKEN",
        "HS_TOKEN",
        "PROVISIONING_SECRET",
      ] as const,
      (key) =>
        Effect.gen(function* () {
          const random = yield* Random(`WhatsApp${key}`, { bytes: 32 }).pipe(
            retain(true)
          );
          const bridge = yield* Fly.Secret(`WhatsApp${key}Secret`, {
            app,
            name: `ZOEN_WHATSAPP_${key}`,
            value: random.text,
          }).pipe(retain(true));
          const postgres =
            key === "DATABASE_PASSWORD"
              ? yield* Fly.Secret("WhatsAppPostgresPassword", {
                  app: input.postgresApp,
                  name: "ZOEN_WHATSAPP_DATABASE_PASSWORD",
                  value: random.text,
                }).pipe(retain(true))
              : undefined;
          const web =
            key === "AS_TOKEN" || key === "PROVISIONING_SECRET"
              ? yield* Fly.Secret(`WebWhatsApp${key}`, {
                  app: input.webApp,
                  name: `ZOEN_WHATSAPP_${key}`,
                  value: random.text,
                }).pipe(retain(true))
              : undefined;
          const matrix =
            key === "AS_TOKEN" || key === "HS_TOKEN"
              ? yield* Fly.Secret(`MatrixWhatsApp${key}`, {
                  app: input.matrixApp,
                  name: `ZOEN_WHATSAPP_${key}`,
                  value: random.text,
                }).pipe(retain(true))
              : undefined;
          return {
            key,
            bridge: bridge.digest,
            postgres: postgres?.digest ?? Output.literal(undefined),
            web: web?.digest ?? Output.literal(undefined),
            matrix: matrix?.digest ?? Output.literal(undefined),
          };
        })
    );
    return {
      app,
      name,
      databaseVersion: Output.all(
        ...secrets
          .filter((secret) => secret.key === "DATABASE_PASSWORD")
          .map((secret) => secret.postgres)
      ).pipe(Output.map((values) => JSON.stringify(values))),
      webVersion: Output.all(
        ...secrets
          .filter(
            (secret) =>
              secret.key === "AS_TOKEN" || secret.key === "PROVISIONING_SECRET"
          )
          .map((secret) => secret.web)
      ).pipe(Output.map((values) => JSON.stringify(values))),
      version: Output.all(...secrets.map((secret) => secret.bridge)).pipe(
        Output.map((values) => JSON.stringify(values))
      ),
    };
  }
);

export const deployWhatsAppBridge = Effect.fn("deployWhatsAppBridge")(
  function* (input: {
    provision: Effect.Success<ReturnType<typeof provisionWhatsAppBridge>>;
    postgresApp: string;
    databaseRelease: Output.Output<string>;
    matrixApp: string;
    serverName: string;
    region: string;
  }) {
    const image = yield* releaseImage(
      "WhatsApp",
      input.provision.name,
      "./whatsapp-bridge"
    );
    return yield* Fly.Machine("WhatsApp", {
      app: input.provision.app,
      name: "whatsapp",
      region: input.region,
      count: 1,
      image,
      guest: { cpuKind: "shared", cpus: 1, memoryMb: 512 },
      env: {
        ZOEN_WHATSAPP_HOMESERVER_ADDRESS: `http://${input.matrixApp}.internal:8008`,
        ZOEN_WHATSAPP_HOMESERVER_DOMAIN: input.serverName,
        ZOEN_WHATSAPP_APPSERVICE_ADDRESS: `http://${input.provision.name}.internal:29318`,
        ZOEN_DATABASE_HOST: `${input.postgresApp}.internal`,
      },
      services: [],
      restart: { policy: "always" },
      checks: {
        health: {
          type: "http",
          port: 29318,
          method: "GET",
          path: "/_matrix/mau/live",
          interval: "30s",
          timeout: "5s",
          grace_period: "2m0s",
        },
      },
      metadata: {
        "zoen.secrets": input.provision.version,
        "zoen.database-ready": input.databaseRelease,
      },
    }).pipe(retain(true));
  }
);
