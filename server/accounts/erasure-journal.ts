import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { env } from "@shared/environment/env";

const recordSchema = Schema.Struct({
  userId: Schema.String.check(
    Schema.isPattern(/^better-auth:[a-zA-Z0-9_-]{1,160}$/)
  ),
});

class ErasureJournalError extends Schema.TaggedError<ErasureJournalError>()(
  "ErasureJournalError",
  { reason: Schema.Literals(["unconfigured", "unavailable"]) }
) {}

const unavailable = () => new ErasureJournalError({ reason: "unavailable" });
const client = Effect.acquireRelease(
  Effect.gen(function* () {
    if (
      !env.ZOEN_ERASURE_JOURNAL_BUCKET ||
      !env.ZOEN_ERASURE_JOURNAL_ACCESS_KEY ||
      !env.ZOEN_ERASURE_JOURNAL_SECRET_KEY
    )
      return yield* new ErasureJournalError({ reason: "unconfigured" });
    return {
      bucket: env.ZOEN_ERASURE_JOURNAL_BUCKET,
      s3: new S3Client({
        endpoint: env.ZOEN_ERASURE_JOURNAL_ENDPOINT,
        region: "auto",
        forcePathStyle: true,
        maxAttempts: 2,
        credentials: {
          accessKeyId: Redacted.value(env.ZOEN_ERASURE_JOURNAL_ACCESS_KEY),
          secretAccessKey: Redacted.value(env.ZOEN_ERASURE_JOURNAL_SECRET_KEY),
        },
      }),
    };
  }),
  ({ s3 }) =>
    Effect.sync(() => {
      s3.destroy();
    })
);

const makeJournal = Effect.sync(() => ({
  append: Effect.fn("ErasureJournal.append")(
    function* (userId: string) {
      const record = yield* Schema.decodeUnknownEffect(recordSchema)({
        userId,
      }).pipe(Effect.mapError(unavailable));
      const { s3, bucket } = yield* client;
      yield* Effect.tryPromise({
        try: (signal) =>
          s3
            .send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `erasures/${Buffer.from(record.userId).toString("base64url")}.json`,
                Body: JSON.stringify(record),
                ContentType: "application/json",
                IfNoneMatch: "*",
              }),
              { abortSignal: signal }
            )
            // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SDK rejection is parsed at this external I/O boundary.
            .catch((error: unknown) => {
              if (
                Schema.is(
                  Schema.Struct({
                    $metadata: Schema.Struct({
                      httpStatusCode: Schema.Literal(412),
                    }),
                  })
                )(error)
              )
                return;
              throw error;
            }),
        catch: unavailable,
      });
    },
    Effect.scoped,
    Effect.timeout("15 seconds"),
    Effect.catchTag("TimeoutError", unavailable)
  ),
  read: Effect.fn("ErasureJournal.read")(
    function* () {
      const { s3, bucket } = yield* client;
      const records: (typeof recordSchema.Type)[] = [];
      let token: string | undefined;
      do {
        const page = yield* Effect.tryPromise({
          try: (signal) =>
            s3.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: "erasures/",
                ContinuationToken: token,
              }),
              { abortSignal: signal }
            ),
          catch: unavailable,
        });
        for (const object of page.Contents ?? []) {
          const text = yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await s3.send(
                new GetObjectCommand({ Bucket: bucket, Key: object.Key }),
                { abortSignal: signal }
              );
              if (!response.Body || (response.ContentLength ?? 0) > 1024)
                throw new Error("Invalid erasure record");
              return response.Body.transformToString();
            },
            catch: unavailable,
          });
          records.push(
            yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(recordSchema)
            )(text).pipe(Effect.mapError(unavailable))
          );
        }
        token = page.NextContinuationToken;
        if (page.IsTruncated && !token) return yield* unavailable();
      } while (token);
      return records;
    },
    Effect.scoped,
    Effect.timeout("5 minutes"),
    Effect.catchTag("TimeoutError", unavailable)
  ),
}));

/** Append-only deletion intent; its bucket is never restored with the application database. */
export class ErasureJournal extends Context.Service<
  ErasureJournal,
  Effect.Success<typeof makeJournal>
>()("zoen/ErasureJournal") {
  static readonly layer = Layer.effect(ErasureJournal, makeJournal);
}
