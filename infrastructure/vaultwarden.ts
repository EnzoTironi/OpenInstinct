import * as Cloudflare from "alchemy/Cloudflare";
import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import { retain } from "alchemy/RemovalPolicy";
import { Config, Effect, Redacted } from "effect";
import { releaseImage } from "./images.ts";
import { production } from "./production.ts";

const requiredVaultCredential = (value: Redacted.Redacted | undefined) => {
  if (!value) throw new Error("Vault backup credential was not created.");
  return value;
};

export const provisionVaultwarden = Effect.fn("provisionVaultwarden")(
  function* (input: { stage: string; postgresApp: Fly.App; webApp: Fly.App }) {
    const prod = input.stage === "prod";
    const name = prod
      ? production.vaultwarden.app
      : `zoen-vault-${input.stage}`;
    const hostname = prod ? production.vaultwarden.hostname : `${name}.fly.dev`;
    const app = yield* Fly.App("VaultwardenApp", {
      name,
      orgSlug: production.organization,
    }).pipe(retain(true));
    const password = yield* Random("VaultDatabasePassword", { bytes: 32 }).pipe(
      retain(true)
    );
    const clientSecret = yield* Random("VaultClientSecret", { bytes: 32 }).pipe(
      retain(true)
    );
    const backupPassword = yield* Random("VaultBackupEncryption", {
      bytes: 32,
    }).pipe(retain(true));
    const bucket = yield* Fly.Bucket("VaultBackups", {
      name: `zoen-vault-backups-${input.stage}`,
      orgSlug: "personal",
      public: false,
      accelerate: false,
    }).pipe(retain(true));
    const database = yield* Fly.Secret("VaultPostgresPassword", {
      app: input.postgresApp,
      name: "ZOEN_VAULTWARDEN_DATABASE_PASSWORD",
      value: password.text,
    }).pipe(retain(true));
    const web = yield* Fly.Secret("VaultWebClientSecret", {
      app: input.webApp,
      name: "ZOEN_VAULTWARDEN_CLIENT_SECRET",
      value: clientSecret.text,
    }).pipe(retain(true));
    const definitions = [
      ["PGPASSWORD", password.text],
      ["SSO_CLIENT_SECRET", clientSecret.text],
      ["RESTIC_PASSWORD", backupPassword.text],
      [
        "AWS_ACCESS_KEY_ID",
        bucket.accessKeyId.pipe(Output.map(requiredVaultCredential)),
      ],
      [
        "AWS_SECRET_ACCESS_KEY",
        bucket.secretAccessKey.pipe(Output.map(requiredVaultCredential)),
      ],
      [
        "RESTIC_REPOSITORY",
        bucket.bucketName.pipe(
          Output.map((value) =>
            Redacted.make(
              `s3:https://fly.storage.tigris.dev/${Redacted.value(requiredVaultCredential(value))}`
            )
          )
        ),
      ],
    ] as const;
    const secrets = yield* Effect.forEach(definitions, ([key, value]) =>
      Fly.Secret(`Vault${key}`, { app, name: key, value }).pipe(retain(true))
    );
    return {
      app,
      name,
      hostname,
      databaseVersion: database.digest,
      webVersion: web.digest,
      version: Output.all(...secrets.map((secret) => secret.digest)).pipe(
        Output.map((values) => JSON.stringify(values))
      ),
    };
  }
);

export const deployVaultwarden = Effect.fn("deployVaultwarden")(
  function* (input: {
    stage: string;
    provision: Effect.Success<ReturnType<typeof provisionVaultwarden>>;
    postgresApp: string;
    issuer: string;
    databaseRelease: Output.Output<string>;
  }) {
    const { app, name, hostname } = input.provision;
    const image = yield* releaseImage("Vaultwarden", name, "./vaultwarden");
    const machine = yield* Fly.Machine("Vaultwarden", {
      app,
      name: "vaultwarden",
      region: production.region,
      count: 1,
      image,
      guest: { cpuKind: "shared", cpus: 1, memoryMb: 512 },
      env: {
        DOMAIN: `https://${hostname}`,
        PGHOST: `${input.postgresApp}.internal`,
        ROCKET_PORT: "8080",
        ZOEN_VAULT_BACKUPS_ENABLED: "true",
        SIGNUPS_ALLOWED: "false",
        INVITATIONS_ALLOWED: "false",
        SIGNUPS_DOMAINS_WHITELIST: "",
        SSO_ENABLED: "true",
        SSO_ONLY: "true",
        SSO_SIGNUPS_ALLOWED: "true",
        SSO_SIGNUPS_MATCH_EMAIL: "false",
        SSO_ALLOW_UNKNOWN_EMAIL_VERIFICATION: "false",
        SSO_CLIENT_ID: "zoen-vaultwarden",
        SSO_AUTHORITY: input.issuer,
        SSO_SCOPES: "email profile offline_access",
        SSO_PKCE: "true",
        SSO_AUTH_ONLY_NOT_SESSION: "false",
        SSO_DEBUG_TOKENS: "false",
        ORG_CREATION_USERS: "none",
        EMERGENCY_ACCESS_ALLOWED: "false",
        PASSWORD_HINTS_ALLOWED: "false",
        ICON_BLACKLIST_NON_GLOBAL_IPS: "true",
        USER_ATTACHMENT_LIMIT: "102400",
        ORG_ATTACHMENT_LIMIT: "102400",
        USER_SEND_LIMIT: "10240",
        LOG_LEVEL: "warn",
        EXTENDED_LOGGING: "false",
        ADMIN_TOKEN: "",
      },
      mounts: [
        {
          path: "/data",
          name: "vaultwarden_data",
          sizeGb: 3,
          encrypted: true,
          autoBackupEnabled: true,
          snapshotRetention: 14,
        },
      ],
      services: [
        {
          protocol: "tcp",
          internalPort: 8080,
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
        health: {
          type: "http",
          port: 8080,
          path: "/alive",
          method: "GET",
          interval: "30s",
          timeout: "5s",
          grace_period: "2m0s",
        },
      },
      restart: { policy: "always" },
      metadata: {
        "zoen.secrets": input.provision.version,
        "zoen.database-ready": input.databaseRelease,
      },
    }).pipe(retain(true));
    const ipv4 = yield* Fly.IpAssignment("VaultIpv4", {
      app,
      type: "shared_v4",
    }).pipe(retain(true));
    const ipv6 = yield* Fly.IpAssignment("VaultIpv6", { app, type: "v6" }).pipe(
      retain(true)
    );
    if (input.stage === "prod") {
      yield* Fly.Certificate("VaultCertificate", { app, hostname }).pipe(
        retain(true)
      );
      const zoneId = yield* Config.string("ZOEN_CLOUDFLARE_ZONE_ID");
      yield* Cloudflare.DNS.Record("VaultDnsIpv4", {
        zoneId,
        name: hostname,
        type: "A",
        content: ipv4.ip,
        proxied: false,
      }).pipe(retain(true));
      yield* Cloudflare.DNS.Record("VaultDnsIpv6", {
        zoneId,
        name: hostname,
        type: "AAAA",
        content: ipv6.ip,
        proxied: false,
      }).pipe(retain(true));
    }
    return machine;
  }
);
