import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { getVercelOidcToken } from "@vercel/oidc";
import { Config, ConfigProvider, Effect, Layer, Option, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";

import {
  InternalCallbackRejected,
  internalCallbackBodies,
  internalCallbackHeaders,
  internalCallbackOrigin,
  type InternalCallbackRoute,
} from "../../server/internal/callback-auth";

const encodeSchema_fromJsonString_Schema_Unknown = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Unknown)
);

const decodeJsonUnknown = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown)
);

const decodeInternalCallbackBodies = {
  "/internal/channel-input/respond": Schema.decodeUnknownEffect(
    internalCallbackBodies["/internal/channel-input/respond"],
    { onExcessProperty: "error" }
  ),
  "/internal/scheduled-run/report": Schema.decodeUnknownEffect(
    internalCallbackBodies["/internal/scheduled-run/report"],
    { onExcessProperty: "error" }
  ),
  "/internal/scheduled-run/respond": Schema.decodeUnknownEffect(
    internalCallbackBodies["/internal/scheduled-run/respond"],
    { onExcessProperty: "error" }
  ),
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

    const http = yield* HttpClient.HttpClient;
    const headerRecord = Object.fromEntries(headers.entries());

    const request = HttpClientRequest.post(new URL(route, origin).href).pipe(
      HttpClientRequest.setHeaders(headerRecord),
      HttpClientRequest.bodyText(serialized, "application/json")
    );

    const response = yield* http.execute(request).pipe(
      Effect.mapError(() => new InternalCallbackRejected({ status: 503 })),
      Effect.timeout("10 seconds"),
      Effect.catchTag(
        "TimeoutError",
        () => new InternalCallbackRejected({ status: 503 })
      ),
      Effect.provideService(FetchHttpClient.RequestInit, {
        redirect: "error",
      })
    );

    const bodyText = yield* response.text.pipe(
      Effect.mapError(() => new InternalCallbackRejected({ status: 503 }))
    );

    const bodyJson = yield* decodeJsonUnknown(bodyText).pipe(
      Effect.mapError(() => new InternalCallbackRejected({ status: 503 }))
    );

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => bodyJson,
    };
  }
);

export function postInternalRequest<Route extends InternalCallbackRoute>(
  route: Route,
  body: (typeof internalCallbackBodies)[Route]["Type"]
) {
  return Effect.runPromise(
    postInternalRequestEffect(route, body).pipe(
      Effect.provide(
        Layer.mergeAll(
          ResolvedInstallationSecrets.layer,
          FetchHttpClient.layer,
          Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())
        )
      )
    )
  );
}
