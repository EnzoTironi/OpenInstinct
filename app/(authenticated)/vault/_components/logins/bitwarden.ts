import { Effect, Redacted, Schema } from "effect";
import { argon2id } from "hash-wasm";
import {
  loginIdentifierSchema,
  serializeLoginVaultPayload,
  type VaultImportItems,
} from "@shared/vault/schema";

const boundedText = Schema.String.check(Schema.isMaxLength(14_000_000));
const encryptedFields = {
  encrypted: Schema.Literal(true),
  passwordProtected: Schema.Literal(true),
  salt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  encKeyValidation_DO_NOT_EDIT: boundedText,
  data: boundedText,
};
const exportSchema = Schema.Union([
  Schema.Struct({
    ...encryptedFields,
    kdfType: Schema.Literal(0),
    kdfIterations: Schema.Int.check(
      Schema.isBetween({ minimum: 5_000, maximum: 2_000_000 })
    ),
  }),
  Schema.Struct({
    ...encryptedFields,
    kdfType: Schema.Literal(1),
    kdfIterations: Schema.Int.check(
      Schema.isBetween({ minimum: 2, maximum: 10 })
    ),
    kdfMemory: Schema.Int.check(
      Schema.isBetween({ minimum: 16, maximum: 128 })
    ),
    kdfParallelism: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: 8 })
    ),
  }),
]);
const documentSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      type: Schema.Number,
      name: Schema.String,
      deletedDate: Schema.optional(Schema.NullOr(Schema.String)),
      login: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            username: Schema.optional(Schema.NullOr(Schema.String)),
            password: Schema.optional(Schema.NullOr(Schema.String)),
            totp: Schema.optional(Schema.NullOr(Schema.String)),
            uris: Schema.optional(
              Schema.NullOr(
                Schema.Array(
                  Schema.Struct({
                    uri: Schema.optional(Schema.NullOr(Schema.String)),
                  })
                )
              )
            ),
          })
        )
      ),
    })
  ).check(Schema.isMaxLength(3_000)),
});

export class VaultImportFailed extends Schema.TaggedError<VaultImportFailed>()(
  "VaultImportFailed",
  {}
) {}

/** Portable password-protected exports only; never accepts a user's account key. */
export const openBitwardenExport = Effect.fn("openBitwardenExport")(
  function* (source: string, password: Redacted.Redacted) {
    const bounded = yield* Schema.decodeUnknownEffect(boundedText)(source);
    const envelope = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(exportSchema)
    )(bounded);
    const material = yield* exportKey(envelope, password);
    return yield* Effect.acquireUseRelease(
      Effect.succeed(material),
      Effect.fn(function* (key) {
        const hmac = yield* Effect.tryPromise(() =>
          crypto.subtle.importKey(
            "raw",
            key,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
          )
        );
        // Bitwarden uses HKDF-expand, without extract, on the password-derived key.
        const enc = yield* Effect.tryPromise(() =>
          crypto.subtle.sign(
            "HMAC",
            hmac,
            new Uint8Array([...new TextEncoder().encode("enc"), 1])
          )
        );
        const mac = yield* Effect.tryPromise(() =>
          crypto.subtle.sign(
            "HMAC",
            hmac,
            new Uint8Array([...new TextEncoder().encode("mac"), 1])
          )
        );
        const encryption = yield* Effect.tryPromise(() =>
          crypto.subtle.importKey("raw", enc, "AES-CBC", false, ["decrypt"])
        );
        const authentication = yield* Effect.tryPromise(() =>
          crypto.subtle.importKey(
            "raw",
            mac,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
          )
        );
        new Uint8Array(enc).fill(0);
        new Uint8Array(mac).fill(0);
        const validation = yield* decryptExportCipher(
          envelope.encKeyValidation_DO_NOT_EDIT,
          encryption,
          authentication
        );
        validation.fill(0);
        const plaintext = yield* decryptExportCipher(
          envelope.data,
          encryption,
          authentication
        );
        return yield* Effect.acquireUseRelease(
          Effect.succeed(plaintext),
          Effect.fn(function* (bytes) {
            const document = yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(documentSchema)
            )(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            return convertLogins(document);
          }),
          (bytes) =>
            Effect.sync(() => {
              bytes.fill(0);
            })
        );
      }),
      (key) =>
        Effect.sync(() => {
          key.fill(0);
        })
    );
  },
  Effect.mapError(() => new VaultImportFailed())
);

const exportKey = Effect.fn("bitwardenExportKey")(function* (
  envelope: typeof exportSchema.Type,
  password: Redacted.Redacted
) {
  const salt = new TextEncoder().encode(envelope.salt);
  const passwordBytes = new TextEncoder().encode(Redacted.value(password));
  return yield* Effect.acquireUseRelease(
    Effect.succeed(passwordBytes),
    Effect.fn(function* (bytes) {
      if (envelope.kdfType === 1) {
        const saltHash = yield* Effect.tryPromise(() =>
          crypto.subtle.digest("SHA-256", salt)
        );
        return new Uint8Array(
          yield* Effect.tryPromise(() =>
            argon2id({
              password: bytes,
              salt: new Uint8Array(saltHash),
              hashLength: 32,
              iterations: envelope.kdfIterations,
              memorySize: envelope.kdfMemory * 1024,
              parallelism: envelope.kdfParallelism,
              outputType: "binary",
            })
          )
        );
      }
      const key = yield* Effect.tryPromise(() =>
        crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveBits"])
      );
      return new Uint8Array(
        yield* Effect.tryPromise(() =>
          crypto.subtle.deriveBits(
            {
              name: "PBKDF2",
              hash: "SHA-256",
              salt,
              iterations: envelope.kdfIterations,
            },
            key,
            256
          )
        )
      );
    }),
    (bytes) =>
      Effect.sync(() => {
        bytes.fill(0);
      })
  );
});

const decryptExportCipher = Effect.fn("decryptBitwardenExportCipher")(
  function* (cipher: string, encryption: CryptoKey, authentication: CryptoKey) {
    const parts =
      /^2\.([A-Za-z0-9+/]+=*)\|([A-Za-z0-9+/]+=*)\|([A-Za-z0-9+/]+=*)$/.exec(
        cipher
      );
    if (!parts) return yield* new VaultImportFailed();
    const [iv, encrypted, signature] = yield* Effect.try(() =>
      parts
        .slice(1)
        .map((part) =>
          Uint8Array.from(atob(part), (char) => char.charCodeAt(0))
        )
    );
    if (
      !iv ||
      !encrypted ||
      !signature ||
      iv.length !== 16 ||
      signature.length !== 32 ||
      encrypted.length % 16 !== 0
    )
      return yield* new VaultImportFailed();
    const valid = yield* Effect.tryPromise(() =>
      crypto.subtle.verify(
        "HMAC",
        authentication,
        signature,
        new Uint8Array([...iv, ...encrypted])
      )
    );
    if (!valid) return yield* new VaultImportFailed();
    return new Uint8Array(
      yield* Effect.tryPromise(() =>
        crypto.subtle.decrypt({ name: "AES-CBC", iv }, encryption, encrypted)
      )
    );
  }
);

function convertLogins(document: typeof documentSchema.Type) {
  const items: VaultImportItems = [];
  let skipped = 0;
  for (const item of document.items) {
    const login = item.login;
    if (
      item.type !== 1 ||
      item.deletedDate ||
      !login?.username ||
      !login.password
    ) {
      skipped++;
      continue;
    }
    const origins = new Set(
      (login.uris ?? []).flatMap(({ uri }) => {
        if (!uri || !URL.canParse(uri)) return [];
        const url = new URL(uri);
        return url.protocol === "https:" && !url.username && !url.password
          ? [url.origin]
          : [];
      })
    );
    if (
      origins.size !== 1 ||
      item.name.length > 120 ||
      login.username.length > 300 ||
      login.password.length > 16_000 ||
      (login.totp?.length ?? 0) > 2_048
    ) {
      skipped++;
      continue;
    }
    const origin = [...origins][0];
    if (!origin || !item.name.trim()) {
      skipped++;
      continue;
    }
    items.push({
      kind: "login",
      account: "",
      label: item.name,
      secret: serializeLoginVaultPayload({
        kind: "login",
        version: 2,
        origin,
        identifier: {
          type: loginIdentifierSchema.safeParse({
            type: "email",
            value: login.username,
          }).success
            ? "email"
            : "username",
          value: login.username,
        },
        authentication: {
          type: "password",
          password: login.password,
          totp: login.totp?.length ? login.totp : undefined,
        },
      }),
    });
  }
  return { items, skipped };
}
