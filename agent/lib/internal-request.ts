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

function rejectInternalCallback() {
  return new InternalCallbackRejected({ status: 503 });
}

function readOidcToken() {
  return getVercelOidcToken();
}

function isSuccessfulStatus(status: number) {
  return status >= 200 && status < 300;
}

const resolveVercelCallbackTransport = Effect.fn(
  "resolveVercelCallbackTransport"
)(function* () {
  const hostname = yield* Config.string("VERCEL_URL");
  const origin = new URL(`https://${hostname}`).origin;

  const token = yield* Effect.tryPromise({
    try: readOidcToken,
    catch: rejectInternalCallback,
  });

  return {
    headers: new Headers({
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-vercel-trusted-oidc-idp-token": token,
    }),
    origin,
  };
});

const resolveLocalCallbackTransport = Effect.fn(
  "resolveLocalCallbackTransport"
)(function* (route: InternalCallbackRoute, serialized: string) {
  return {
    headers: yield* internalCallbackHeaders(route, serialized),
    origin: yield* internalCallbackOrigin,
  };
});

const resolveCallbackTransport = Effect.fn("resolveCallbackTransport")(
  function* (route: InternalCallbackRoute, serialized: string) {
    const vercel = yield* Config.option(Config.string("VERCEL_ENV"));

    if (Option.isSome(vercel)) {
      return yield* resolveVercelCallbackTransport();
    }

    return yield* resolveLocalCallbackTransport(route, serialized);
  }
);

const executeInternalHttpRequest = Effect.fn("executeInternalHttpRequest")(
  function* (
    route: InternalCallbackRoute,
    origin: string,
    headers: Headers,
    serialized: string
  ) {
    const http = yield* HttpClient.HttpClient;
    const headerRecord = Object.fromEntries(headers.entries());

    const request = HttpClientRequest.post(new URL(route, origin).href).pipe(
      HttpClientRequest.setHeaders(headerRecord),
      HttpClientRequest.bodyText(serialized, "application/json")
    );

    return yield* http.execute(request).pipe(
      Effect.mapError(rejectInternalCallback),
      Effect.timeout("10 seconds"),
      Effect.catchTag("TimeoutError", rejectInternalCallback),
      Effect.provideService(FetchHttpClient.RequestInit, {
        redirect: "error",
      })
    );
  }
);

const readInternalResponseJson = Effect.fn("readInternalResponseJson")(
  function* (response: { readonly text: Effect.Effect<string, unknown> }) {
    const bodyText = yield* response.text.pipe(
      Effect.mapError(rejectInternalCallback)
    );

    return yield* decodeJsonUnknown(bodyText).pipe(
      Effect.mapError(rejectInternalCallback)
    );
  }
);

function asAsyncJson<T>(bodyJson: T) {
  return async () => bodyJson;
}

export const postInternalRequestEffect = Effect.fn("postInternalRequestEffect")(
  function* <Route extends InternalCallbackRoute>(
    route: Route,
    body: (typeof internalCallbackBodies)[Route]["Type"]
  ) {
    const value = yield* decodeInternalCallbackBodies[route](body);
    const serialized = yield* encodeSchema_fromJsonString_Schema_Unknown(value);
    const transport = yield* resolveCallbackTransport(route, serialized);

    const response = yield* executeInternalHttpRequest(
      route,
      transport.origin,
      transport.headers,
      serialized
    );

    const bodyJson = yield* readInternalResponseJson(response);

    return {
      ok: isSuccessfulStatus(response.status),
      status: response.status,
      json: asAsyncJson(bodyJson),
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
