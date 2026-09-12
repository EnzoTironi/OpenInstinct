import { Context, Effect, Layer, Predicate, Schema } from "effect";

export const MailboxUpload = Schema.TaggedStruct("MailboxUpload", {
  format: Schema.Literals(["mbox", "eml"]),
  bytes: Schema.Uint8Array,
});

export type MailboxUpload = typeof MailboxUpload.Type;

export const LocalImap = Schema.TaggedStruct("LocalImap", {
  host: Schema.NonEmptyString,
  port: Schema.Int,
  user: Schema.NonEmptyString,
  mailbox: Schema.NonEmptyString,
});

export type LocalImap = typeof LocalImap.Type;

export const SourceSpec = Schema.Union([MailboxUpload, LocalImap]);

export type SourceSpec = typeof SourceSpec.Type;

export const MailboxBytes = Schema.Struct({
  format: Schema.Literals(["mbox", "eml"]),
  bytes: Schema.Uint8Array,
});

export type MailboxBytes = typeof MailboxBytes.Type;

export class SourceError extends Schema.TaggedError<SourceError>()(
  "SourceError",
  {
    reason: Schema.Literals(["imap_not_wired", "empty"]),
  }
) {}

interface Connection {
  readonly read: (
    spec: SourceSpec
  ) => Effect.Effect<MailboxBytes, SourceError>;
}

const decodeSpec = Schema.decodeUnknownEffect(SourceSpec);

const readUpload = (spec: MailboxUpload) =>
  spec.bytes.byteLength === 0
    ? Effect.fail(new SourceError({ reason: "empty" }))
    : Effect.succeed({ bytes: spec.bytes, format: spec.format });

const readImap = (_spec: LocalImap) =>
  Effect.fail(new SourceError({ reason: "imap_not_wired" }));

const readSpec = (spec: SourceSpec) =>
  Predicate.isTagged(spec, "MailboxUpload") ? readUpload(spec) : readImap(spec);

const makeSourceConnection = Effect.sync(() =>
  SourceConnection.of({
    read: Effect.fn("SourceConnection.read")(function* (input: SourceSpec) {
      const spec = yield* decodeSpec(input).pipe(
        Effect.mapError(() => new SourceError({ reason: "empty" }))
      );
      return yield* readSpec(spec);
    }),
  })
);

export class SourceConnection extends Context.Service<
  SourceConnection,
  Connection
>()("companion/operon/SourceConnection") {
  static readonly layer = Layer.effect(SourceConnection, makeSourceConnection);
}
