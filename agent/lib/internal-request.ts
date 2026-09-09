import { getVercelOidcToken } from "@vercel/oidc";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { Config, ConfigProvider, Effect, Option, Schema } from "effect";
import {
  InternalCallbackRejected,
  internalCallbackBodies,
  internalCallbackHeaders,
  internalCallbackOrigin,
  type InternalCallbackRoute,
} from "../../server/internal/callback-auth";

export const postInternalRequestEffect = Effect.fn("postInternalRequestEffect")(
  function* <Route extends InternalCallbackRoute>(
    route: Route,
    body: (typeof internalCallbackBodies)[Route]["Type"]
  ) {
    const schema: Schema.Codec<unknown> = internalCallbackBodies[route];
    const value = yield* Schema.decodeUnknownEffect(schema, {
      onExcessProperty: "error",
    })(body);
    const serialized = JSON.stringify(value);
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
