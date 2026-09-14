import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { authentication } from "@db/services/auth";
import { Effect, Schema } from "effect";
import {
  ModelConnectionError,
  ModelProviderSchema,
} from "../../shared/models/catalog";

const Envelope = Schema.Struct({
  workspaceId: Schema.String,
  provider: ModelProviderSchema,
  value: Schema.String,
});

export const sealModelSecret = Effect.fn("sealModelSecret")(function* (
  workspaceId: string,
  provider: typeof ModelProviderSchema.Type,
  value: string
) {
  const auth = yield* authentication;
  return yield* Effect.tryPromise({
    try: async () =>
      symmetricEncrypt({
        key: (await auth.$context).secretConfig,
        data: JSON.stringify({ workspaceId, provider, value }),
      }),
    catch: () => new ModelConnectionError({ reason: "unavailable" }),
  });
});

export const openModelSecret = Effect.fn("openModelSecret")(function* (
  workspaceId: string,
  provider: typeof ModelProviderSchema.Type,
  data: string
) {
  const auth = yield* authentication;
  const plain = yield* Effect.tryPromise({
    try: async () =>
      symmetricDecrypt({ key: (await auth.$context).secretConfig, data }),
    catch: () => new ModelConnectionError({ reason: "reconnect" }),
  });
  const envelope = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Envelope)
  )(plain).pipe(
    Effect.mapError(() => new ModelConnectionError({ reason: "reconnect" }))
  );
  if (envelope.workspaceId !== workspaceId || envelope.provider !== provider)
    return yield* new ModelConnectionError({ reason: "reconnect" });
  return envelope.value;
});
