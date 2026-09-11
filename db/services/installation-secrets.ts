import { createHash, randomBytes } from "node:crypto";

import {
  betterAuthSecretSchema,
  env,
  secretEncryptionKeySchema,
} from "@shared/environment";
import { get, put } from "@vercel/blob";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { z } from "zod";

const installationSecretsSchema = z.object({
  betterAuthSecret: betterAuthSecretSchema,
  secretEncryptionKey: secretEncryptionKeySchema,
  version: z.literal(1),
});

export type InstallationSecrets = z.infer<typeof installationSecretsSchema>;

const maximumInstallationSecretsBytes = 1024;

let installationSecretsPromise: Promise<InstallationSecrets> | undefined;

export function getInstallationSecrets() {
  installationSecretsPromise ??= resolveInstallationSecretsWithRetry();

  return installationSecretsPromise;
}

async function resolveInstallationSecretsWithRetry() {
  try {
    return await resolveInstallationSecrets();
  } catch (error) {
    installationSecretsPromise = undefined;
    throw error;
  }
}

function requireBlobStoreConfigured() {
  if (env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN) {
    return;
  }

  throw new Error(
    "Installation secrets are unavailable. Connect a private Vercel Blob store or set both BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY."
  );
}

function generateInstallationSecrets() {
  return installationSecretsSchema.parse({
    betterAuthSecret: randomBytes(32).toString("base64"),
    secretEncryptionKey: randomBytes(32).toString("base64"),
    version: 1,
  });
}

async function putGeneratedInstallationSecrets(
  pathname: string,
  generated: ReturnType<typeof generateInstallationSecrets>
) {
  await put(pathname, JSON.stringify(generated), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 365 * 24 * 60 * 60,
    contentType: "application/json",
    maximumSizeInBytes: maximumInstallationSecretsBytes,
  });
}

async function createOrReadInstallationSecrets(pathname: string) {
  const generated = generateInstallationSecrets();

  try {
    await putGeneratedInstallationSecrets(pathname, generated);

    return generated;
  } catch (error) {
    const winner = await readInstallationSecrets(pathname);

    if (winner) {
      return winner;
    }

    throw error;
  }
}

async function resolveInstallationSecrets() {
  const configured = configuredInstallationSecrets();

  if (configured) {
    return configured;
  }

  requireBlobStoreConfigured();
  const pathname = installationSecretsPathname();
  const existing = await readInstallationSecrets(pathname);

  if (existing) {
    return existing;
  }

  return createOrReadInstallationSecrets(pathname);
}

function configuredInstallationSecrets() {
  const betterAuthSecret = env.BETTER_AUTH_SECRET;
  const secretEncryptionKey = env.SECRET_ENCRYPTION_KEY;

  if (!betterAuthSecret && !secretEncryptionKey) return undefined;

  if (!betterAuthSecret || !secretEncryptionKey) {
    throw new Error(
      "Set both BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY, or leave both unset for automatic private Blob provisioning."
    );
  }

  return installationSecretsSchema.parse({
    betterAuthSecret,
    secretEncryptionKey,
    version: 1,
  });
}

async function readInstallationSecrets(pathname: string) {
  const result = await get(pathname, {
    access: "private",
    useCache: false,
  });

  if (!result) return undefined;

  if (result.statusCode !== 200) {
    throw new Error("The installation secrets Blob returned no content.");
  }

  if (result.blob.size > maximumInstallationSecretsBytes) {
    throw new Error("The installation secrets Blob is unexpectedly large.");
  }

  const value: unknown = await new Response(result.stream).json();

  return installationSecretsSchema.parse(value);
}

function installationSecretsPathname() {
  const scope = createHash("sha256")
    .update(env.VERCEL_PROJECT_ID ?? "standalone")
    .digest("hex")
    .slice(0, 32);

  return `openinstinct/system/${scope}/installation-secrets.v1.json`;
}

class InstallationSecretsUnavailable extends Schema.TaggedError<InstallationSecretsUnavailable>()(
  "InstallationSecretsUnavailable",
  {}
) {}

/**
 * One resolved installation-secrets config for Effect services.
 * Always sourced through getInstallationSecrets (explicit env or Blob provision).
 */
export class ResolvedInstallationSecrets extends Context.Service<
  ResolvedInstallationSecrets,
  {
    readonly betterAuthSecret: Redacted.Redacted;
    readonly secretEncryptionKey: Redacted.Redacted;
  }
>()("companion/ResolvedInstallationSecrets") {
  static readonly layer = Layer.effect(
    ResolvedInstallationSecrets,
    Effect.gen(function* () {
      const secrets = yield* Effect.tryPromise({
        try: () => getInstallationSecrets(),
        catch: () => new InstallationSecretsUnavailable(),
      });

      return ResolvedInstallationSecrets.of({
        betterAuthSecret: Redacted.make(secrets.betterAuthSecret),
        secretEncryptionKey: Redacted.make(secrets.secretEncryptionKey),
      });
    })
  );

  /** Explicit fixture for tests — does not read env or Blob. */
  static layerFromResolved(secrets: {
    readonly betterAuthSecret: string;
    readonly secretEncryptionKey: string;
  }) {
    return Layer.succeed(
      ResolvedInstallationSecrets,
      ResolvedInstallationSecrets.of({
        betterAuthSecret: Redacted.make(secrets.betterAuthSecret),
        secretEncryptionKey: Redacted.make(secrets.secretEncryptionKey),
      })
    );
  }
}
