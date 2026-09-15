import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { authentication } from "@db/services/auth";
import { Effect, Schema } from "effect";
import { ConnectorError } from "./definition";

const Envelope = Schema.Struct({
  purpose: Schema.Literal("tool-connector"),
  workspaceId: Schema.String,
  id: Schema.String,
  revision: Schema.String,
  value: Schema.String,
});

export const sealConnectorCredential = Effect.fn("Connector.sealCredential")(
  function* (workspaceId: string, id: string, revision: string, value: string) {
    const auth = yield* authentication;
    return yield* Effect.tryPromise({
      try: async () =>
        symmetricEncrypt({
          key: (await auth.$context).secretConfig,
          data: JSON.stringify({
            purpose: "tool-connector",
            workspaceId,
            id,
            revision,
            value,
          }),
        }),
      catch: () => new ConnectorError({ reason: "unavailable" }),
    });
  }
);

export const openConnectorCredential = Effect.fn("Connector.openCredential")(
  function* (workspaceId: string, id: string, revision: string, data: string) {
    const auth = yield* authentication;
    const plain = yield* Effect.tryPromise({
      try: async () =>
        symmetricDecrypt({ key: (await auth.$context).secretConfig, data }),
      catch: () => new ConnectorError({ reason: "unavailable" }),
    });
    const envelope = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Envelope)
    )(plain).pipe(
      Effect.mapError(() => new ConnectorError({ reason: "denied" }))
    );
    if (
      envelope.workspaceId !== workspaceId ||
      envelope.id !== id ||
      envelope.revision !== revision
    )
      return yield* new ConnectorError({ reason: "denied" });
    return envelope.value;
  }
);

/** Remove this connection's credential if a provider echoes it in metadata or output. */
export function redactConnectorCredential(
  serialized: string,
  credential: string
) {
  if (!credential) return serialized;
  const variants = [
    credential,
    encodeURIComponent(credential),
    Buffer.from(credential).toString("base64"),
    Buffer.from(credential).toString("base64url"),
  ];
  for (const variant of new Set(
    variants.toSorted((a, b) => b.length - a.length)
  ))
    serialized = serialized.replaceAll(
      JSON.stringify(variant).slice(1, -1),
      "[redacted]"
    );
  return serialized;
}
