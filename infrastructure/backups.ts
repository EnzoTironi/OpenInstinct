import { createHash } from "node:crypto";
import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import { retain } from "alchemy/RemovalPolicy";
import { Effect } from "effect";
import type { Redacted } from "effect";

const requiredCredential = (value: Redacted.Redacted | undefined) => {
  if (!value) throw new Error("Tigris did not return a backup credential");
  return value;
};

export const backupSecrets = (app: Fly.App, stage: string) =>
  Effect.gen(function* () {
    const bucket = yield* Fly.Bucket("PostgresBackups", {
      name: `zoen-postgres-backups-${stage}`,
      // Tigris GraphQL reports the personal-org alias; Machines uses its slug.
      orgSlug: "personal",
      public: false,
      accelerate: false,
    }).pipe(retain(true));
    const cipher = yield* Random("PostgresBackupEncryption", {
      bytes: 32,
    }).pipe(retain(true));
    const definitions = [
      [
        "PGBACKREST_REPO1_S3_BUCKET",
        bucket.bucketName.pipe(Output.map(requiredCredential)),
      ],
      [
        "PGBACKREST_REPO1_S3_KEY",
        bucket.accessKeyId.pipe(Output.map(requiredCredential)),
      ],
      [
        "PGBACKREST_REPO1_S3_KEY_SECRET",
        bucket.secretAccessKey.pipe(Output.map(requiredCredential)),
      ],
      ["PGBACKREST_REPO1_CIPHER_PASS", cipher.text],
    ] as const;
    const secrets = yield* Effect.forEach(definitions, ([name, value]) =>
      Fly.Secret(name, { app, name, value }).pipe(retain(true))
    );
    return Output.all(...secrets.map((secret) => secret.digest)).pipe(
      Output.map((digests) =>
        createHash("sha256").update(JSON.stringify(digests)).digest("hex")
      )
    );
  });
