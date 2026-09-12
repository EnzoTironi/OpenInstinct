import { Context, Effect, Layer, Schema } from "effect";

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

export const GatewayGmail = Schema.TaggedStruct("GatewayGmail", {
  adapter: Schema.Literal("gmail-gateway"),
  accountId: Schema.NonEmptyString,
});

export type GatewayGmail = typeof GatewayGmail.Type;

export const SourceSpec = Schema.Union([MailboxUpload, LocalImap, GatewayGmail]);

export type SourceSpec = typeof SourceSpec.Type;

export const MailboxBytes = Schema.Struct({
  format: Schema.Literals(["mbox", "eml"]),
  bytes: Schema.Uint8Array,
});

export type MailboxBytes = typeof MailboxBytes.Type;

export class SourceError extends Schema.TaggedError<SourceError>()(
  "SourceError",
  {
    reason: Schema.Literals([
      "imap_not_wired",
      "gmail_gateway_not_wired",
      "empty",
    ]),
  }
) {}

interface Connection {
  readonly read: (spec: SourceSpec) => Effect.Effect<MailboxBytes, SourceError>;
}

const decodeSpec = Schema.decodeUnknownEffect(SourceSpec);

const readUpload = (spec: MailboxUpload) =>
  spec.bytes.byteLength === 0
    ? Effect.fail(new SourceError({ reason: "empty" }))
    : Effect.succeed({ bytes: spec.bytes, format: spec.format });

const readImap = (_spec: LocalImap) =>
  Effect.fail(new SourceError({ reason: "imap_not_wired" }));

const readGatewayGmail = (_spec: GatewayGmail) =>
  Effect.fail(new SourceError({ reason: "gmail_gateway_not_wired" }));

const readSpec = (spec: SourceSpec) => {
  switch (spec._tag) {
    case "MailboxUpload":
      return readUpload(spec);
    case "LocalImap":
      return readImap(spec);
    case "GatewayGmail":
      return readGatewayGmail(spec);
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
};

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
