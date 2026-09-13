import * as Cloudflare from "alchemy/Cloudflare";
import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import { adopt } from "alchemy/AdoptPolicy";
import { retain } from "alchemy/RemovalPolicy";
import { Random } from "alchemy/Random";
import { Config, Effect, Redacted } from "effect";
import { CompanionStagePolicy } from "./companion-stage.ts";
import { releaseImage } from "./images.ts";
import { production } from "./production.ts";
import { appSecrets, webSecretNames } from "./secrets.ts";
import { backupSecrets } from "./backups.ts";
import { PrepareServiceDatabases } from "./database.ts";
import { MigrateApplication } from "./migrations.ts";
import { provisionMatrix, deployMatrix } from "./matrix.ts";

export const hosted = Effect.gen(function* () {
  const policy = yield* CompanionStagePolicy;
  const prod = policy.stage === "prod";
  const region = production.region;
  const pgName = prod ? production.database.app : `zoen-pg-${policy.stage}`;
  const webName = prod ? production.web.app : `zoen-${policy.stage}`;
  const memoryName = prod
    ? production.memory.app
    : `zoen-memory-${policy.stage}`;
  const hostname = prod ? production.hostname : `${webName}.fly.dev`;

  const postgresApp = yield* Fly.App("PostgresApp", {
    name: pgName,
    orgSlug: production.organization,
  }).pipe(adopt(prod), retain(true));
  const webApp = yield* Fly.App("WebApp", {
    name: webName,
    orgSlug: production.organization,
  }).pipe(adopt(prod), retain(true));
  const memoryApp = yield* Fly.App("MemoryApp", {
    name: memoryName,
    orgSlug: production.organization,
  }).pipe(adopt(prod), retain(true));
  const matrixSecrets = yield* provisionMatrix({
    stage: policy.stage,
    organization: production.organization,
    region,
    postgresApp,
    webApp,
  });
  const matrixServerName = prod
    ? "matrix.zoen.tironi.xyz"
    : `matrix-${policy.stage}.zoen.invalid`;

  const password = yield* Config.redacted("COMPANION_POSTGRES_PASSWORD");
  const pgSecret = yield* Fly.Secret("PostgresPassword", {
    app: postgresApp,
    name: "POSTGRES_PASSWORD",
    value: password,
  }).pipe(adopt(prod), retain(true));
  const backupVersion = yield* backupSecrets(postgresApp, policy.stage);
  const applicationPassword = yield* Random("ApplicationDatabasePassword", {
    bytes: 32,
  }).pipe(retain(true));
  const migrationPassword = yield* Random("MigrationDatabasePassword", {
    bytes: 32,
  }).pipe(retain(true));
  const applicationCredential = yield* Fly.Secret(
    "ApplicationBootstrapPassword",
    {
      app: postgresApp,
      name: "ZOEN_APPLICATION_DATABASE_PASSWORD",
      value: applicationPassword.text,
    }
  ).pipe(retain(true));
  const migrationCredential = yield* Fly.Secret("MigrationBootstrapPassword", {
    app: postgresApp,
    name: "ZOEN_MIGRATION_DATABASE_PASSWORD",
    value: migrationPassword.text,
  }).pipe(retain(true));
  const applicationCredentialVersion = Output.all(
    applicationCredential.digest,
    migrationCredential.digest
  ).pipe(Output.map((values) => values.join(":")));
  const memoryPassword = yield* Random("MemoryDatabasePassword", {
    bytes: 32,
  }).pipe(retain(true));
  const memoryBootstrapPassword = yield* Fly.Secret("MemoryBootstrapPassword", {
    app: postgresApp,
    name: "ZOEN_MEMORY_DATABASE_PASSWORD",
    value: memoryPassword.text,
  }).pipe(retain(true));
  const preUpgradeSnapshot = prod
    ? yield* Fly.VolumeSnapshot("BeforePgBackRest", {
        app: postgresApp,
        volumeId: production.database.volume,
      }).pipe(retain(true))
    : undefined;
  const pgImage = yield* releaseImage("Postgres", pgName, "./postgres");
  const postgres = yield* Fly.Machine("Postgres", {
    app: postgresApp,
    name: "postgres",
    region,
    count: 1,
    existingMachineIds: prod ? [production.database.machine] : undefined,
    existingVolumeIds: prod
      ? { "/data": production.database.volume }
      : undefined,
    image: pgImage,
    guest: { cpuKind: "shared", cpus: 1, memoryMb: 1024 },
    env: {
      POSTGRES_DB: policy.database,
      POSTGRES_USER: "postgres",
      PGDATA: "/data/pgdata",
      ZOEN_BACKUPS_ENABLED: "1",
    },
    mounts: [
      {
        path: "/data",
        name: "pgdata",
        sizeGb: 10,
        encrypted: true,
        autoBackupEnabled: true,
        snapshotRetention: 14,
      },
    ],
    services: [],
    checks: {
      postgres: {
        type: "tcp",
        port: 5432,
        interval: "15s",
        timeout: "5s",
        grace_period: "1m0s",
      },
    },
    restart: { policy: "always" },
    metadata: {
      role: "companion-unmanaged-postgres",
      "zoen.secret": pgSecret.digest.pipe(Output.map((value) => value ?? "")),
      "zoen.backups": backupVersion,
      "zoen.application-roles": applicationCredentialVersion,
      "zoen.memory-password": memoryBootstrapPassword.digest.pipe(
        Output.map((value) => value ?? "")
      ),
      "zoen.matrix-password": matrixSecrets.databaseVersion,
      "zoen.upgrade-snapshot": preUpgradeSnapshot
        ? preUpgradeSnapshot.snapshotId
        : "new-installation",
    },
  }).pipe(retain(true));

  const databases = yield* PrepareServiceDatabases({
    app: pgName,
    machine: postgres.machineId,
    release: pgImage,
    credentialVersion: Output.all(
      applicationCredentialVersion,
      memoryBootstrapPassword.digest,
      matrixSecrets.databaseVersion
    ).pipe(Output.map((values) => JSON.stringify(values))),
  });
  const matrix = yield* deployMatrix({
    provision: matrixSecrets,
    postgresApp: pgName,
    databaseRelease: databases.release,
    webApp: webName,
    serverName: matrixServerName,
    region,
  });

  const memoryDatabaseSecret = yield* Fly.Secret("MemoryDatabaseUrl", {
    app: memoryApp,
    name: "ZOEN_MEMORY_DATABASE_URL",
    value: memoryPassword.text.pipe(
      Output.map((value) =>
        Redacted.make(
          `postgresql://zoen_memory:${encodeURIComponent(Redacted.value(value))}@${pgName}.internal:5432/zoen_memory`
        )
      )
    ),
  }).pipe(retain(true));

  const memorySecrets = yield* appSecrets("Memory", memoryApp, [
    "OPENROUTER_API_KEY",
    "ZOEN_MEM0_API_KEY",
  ]);
  const memoryImage = yield* releaseImage("Memory", memoryName, "./memory");
  const memory = yield* Fly.Machine("Memory", {
    app: memoryApp,
    name: prod ? production.memory.name : "memory",
    region,
    count: 1,
    existingMachineIds: prod ? [production.memory.machine] : undefined,
    existingVolumeIds: prod ? { "/data": production.memory.volume } : undefined,
    image: memoryImage,
    guest: { cpuKind: "shared", cpus: 1, memoryMb: 1024 },
    env: { MEM0_TELEMETRY: "false", ZOEN_MEMORY_DATA: "/data" },
    mounts: [
      {
        path: "/data",
        name: "zoen_memory_data",
        sizeGb: 3,
        encrypted: true,
        autoBackupEnabled: true,
        snapshotRetention: 14,
      },
    ],
    services: [],
    checks: {
      health: {
        type: "http",
        port: 8000,
        method: "GET",
        path: "/health",
        interval: "30s",
        timeout: "5s",
        grace_period: "1m30s",
      },
    },
    restart: { policy: "always" },
    metadata: {
      "zoen.secrets": memorySecrets,
      "zoen.database": memoryDatabaseSecret.digest.pipe(
        Output.map((value) => value ?? "")
      ),
      "zoen.database-ready": databases.release,
    },
  }).pipe(retain(true));

  const webSecrets = yield* appSecrets("Web", webApp, webSecretNames);
  const databaseUrls = yield* Effect.forEach(
    ["DATABASE_URL", "DATABASE_URL_UNPOOLED"],
    (name) =>
      Fly.Secret(`Web${name}`, {
        app: webApp,
        name,
        value: applicationPassword.text.pipe(
          Output.map((value) =>
            Redacted.make(
              `postgresql://zoen_app:${encodeURIComponent(Redacted.value(value))}@${pgName}.internal:5432/${policy.database}`
            )
          )
        ),
      }).pipe(adopt(prod), retain(true))
  );
  const webImage = yield* releaseImage("Web", webName, "..");
  const migrations = yield* MigrateApplication({
    app: pgName,
    primary: postgres.machineId,
    region,
    database: policy.database,
    image: webImage,
    prepared: databases,
  });
  const web = yield* Fly.Machine("Web", {
    app: webApp,
    name: prod ? production.web.name : "web",
    region,
    count: 1,
    existingMachineIds: prod ? [production.web.machine] : undefined,
    image: webImage,
    guest: { cpuKind: "shared", cpus: 2, memoryMb: 2048 },
    env: {
      NODE_ENV: "production",
      EVE_NEXT_PRODUCTION_PORT: "4274",
      PRIMARY_REGION: region,
      COMPANION_MODEL_PROVIDER: "codex-local",
      COMPANION_BROWSER_MODEL_PROVIDER: "openrouter",
      COMPANION_BROWSER_MODEL: "openai/gpt-5-mini",
      BETTER_AUTH_URL: `https://${hostname}`,
      COMPANION_PUBLIC_BASE_URL: `https://${hostname}`,
      WORKFLOW_LOCAL_BASE_URL: "http://127.0.0.1:3000",
      ZOEN_MEM0_URL: `http://${memoryName}.internal:8000`,
      ZOEN_MATRIX_URL: `http://${matrixSecrets.name}.internal:8008`,
      ZOEN_MATRIX_SERVER_NAME: matrixServerName,
    },
    services: [
      {
        protocol: "tcp",
        internalPort: 3000,
        autostop: "off",
        autostart: true,
        minMachinesRunning: 1,
        ports: [
          { port: 80, handlers: ["http"], forceHttps: true },
          { port: 443, handlers: ["http", "tls"] },
        ],
      },
    ],
    checks: {
      alive: {
        type: "http",
        port: 3000,
        method: "GET",
        path: "/eve/v1/health",
        interval: "15s",
        timeout: "5s",
        grace_period: "1m0s",
      },
    },
    restart: { policy: "always" },
    metadata: {
      "zoen.secrets": webSecrets,
      "zoen.migrated-image": migrations.image,
      "zoen.matrix": matrixSecrets.webVersion,
      "zoen.runtime-database": Output.all(
        ...databaseUrls.map((secret) => secret.digest)
      ).pipe(Output.map((digests) => JSON.stringify(digests))),
    },
  }).pipe(retain(true));
  const ipv4 = yield* Fly.IpAssignment("WebIpv4", {
    app: webApp,
    type: "shared_v4",
  }).pipe(retain(true));
  const ipv6 = yield* Fly.IpAssignment("WebIpv6", {
    app: webApp,
    type: "v6",
  }).pipe(retain(true));
  if (prod) {
    yield* Fly.Certificate("WebCertificate", { app: webApp, hostname }).pipe(
      retain(true)
    );
    const zoneId = yield* Config.string("ZOEN_CLOUDFLARE_ZONE_ID");
    yield* Cloudflare.DNS.Record("WebDnsIpv4", {
      zoneId,
      name: hostname,
      type: "A",
      content: ipv4.ip,
      proxied: false,
    }).pipe(adopt(true), retain(true));
    yield* Cloudflare.DNS.Record("WebDnsIpv6", {
      zoneId,
      name: hostname,
      type: "AAAA",
      content: ipv6.ip,
      proxied: false,
    }).pipe(adopt(true), retain(true));
  }
  return {
    stage: policy.stage,
    url: `https://${hostname}`,
    postgres: postgres.machineId,
    memory: memory.machineId,
    matrix: matrix.machineId,
    web: web.machineId,
  };
}).pipe(Effect.provide(CompanionStagePolicy.layer));
