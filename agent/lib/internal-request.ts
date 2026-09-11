import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { getVercelOidcToken } from "@vercel/oidc";
import { Config, ConfigProvider, Effect, Option, Schema } from "effect";

import {
  InternalCallbackRejected,
  internalCallbackBodies,
  internalCallbackHeaders,
  internalCallbackOrigin,
  type InternalCallbackRoute,
} from "../../server/internal/callback-auth";
const encodeSchema_fromJsonString_Schema_Unknown = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const decodeInternalCallbackBodies = Object.fromEntries(
  Object.entries(internalCallbackBodies).map(([key, schema]) => [
    key,
    Schema.decodeUnknownEffect(schema as Schema.Codec<unknown>, {
      onExcessProperty: "error",
    }),
  ])
) as {
  [K in InternalCallbackRoute]: (
    input: (typeof internalCallbackBodies)[K]["Type"]
  ) => Effect.Effect<
    (typeof internalCallbackBodies)[K]["Type"],
    Schema.SchemaError
  >;
};

export const postInternalRequestEffect = Effect.fn("postInternalRequestEffect")(
  function* <Route extends InternalCallbackRoute>(
    route: Route,
    body: (typeof internalCallbackBodies)[Route]["Type"]
  ) {
    const value = yield* decodeInternalCallbackBodies[route](body);

    const serialized = yield* encodeSchema_fromJsonString_Schema_Unknown(value);

    const vercel = yield* Config.option(Config.string("VERCEL_ENV"));
    let origin: string;
    let headers: Headers;

    if (Option.isSome(vercel)) {
      const hostname = yield* Config.string("VERCEL_URL");
      origin = new URL(`https://${hostname}`).origin;

      const token = yield* Effect.tryPromise({
        try: () => getVercelOidcToken(),
        catch: () => new InternalCallbackRejected({ status: 503 }),
      });

      headers = new Headers({
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-vercel-trusted-oidc-idp-token": token,
      });
    } else {
      origin = yield* internalCallbackOrigin;
      headers = yield* internalCallbackHeaders(route, serialized);
    }

    return yield* Effect.tryPromise({
      try: (signal) =>
        fetch(new URL(route, origin), {
          body: serialized,
          headers,
          method: "POST",
          redirect: "error",
          signal,
        }),
      catch: () => new InternalCallbackRejected({ status: 503 }),
    }).pipe(Effect.timeout("10 seconds"));
  }
);

export function postInternalRequest<Route extends InternalCallbackRoute>(
  route: Route,
  body: (typeof internalCallbackBodies)[Route]["Type"]
) {
  return Effect.runPromise(
    postInternalRequestEffect(route, body).pipe(
      Effect.provide(ResolvedInstallationSecrets.layer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv()
      )
    )
  );
}
