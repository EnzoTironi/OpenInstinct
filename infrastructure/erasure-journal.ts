import { createHash } from "node:crypto";
import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import { retain } from "alchemy/RemovalPolicy";
import { Effect } from "effect";

/** Kept outside Postgres/pgBackRest so restoring application data cannot undo erasure. */
export const provisionErasureJournal = (app: Fly.App, stage: string) =>
  Effect.gen(function* () {
    const bucket = yield* Fly.Bucket("AccountErasureJournal", {
      name: `zoen-erasure-journal-${stage}`,
      orgSlug: "personal",
      public: false,
      accelerate: false,
    }).pipe(retain(true));
    const definitions = [
      ["ZOEN_ERASURE_JOURNAL_BUCKET", bucket.bucketName],
      ["ZOEN_ERASURE_JOURNAL_ACCESS_KEY", bucket.accessKeyId],
      ["ZOEN_ERASURE_JOURNAL_SECRET_KEY", bucket.secretAccessKey],
    ] as const;
    const secrets = yield* Effect.forEach(definitions, ([name, value]) =>
      Fly.Secret(`Erasure${name}`, {
        app,
        name,
        value: value.pipe(
          Output.map((credential) => {
            if (!credential)
              throw new Error(
                "Tigris did not return an erasure journal credential"
              );
            return credential;
          })
        ),
      }).pipe(retain(true))
    );
    return Output.all(...secrets.map((secret) => secret.digest)).pipe(
      Output.map((digests) =>
        createHash("sha256").update(JSON.stringify(digests)).digest("hex")
      )
    );
  });
