import { ConfigProvider, Effect, Schema } from "effect";
import { defineChannel, POST } from "eve/channels";
import {
  internalCallbackBodies,
  readAuthenticatedInternalCallback,
} from "../../server/internal/callback-auth";
import { serverRuntime } from "../../server/runtime";
import { submitChannelResponse } from "../lib/channel-response";

const route = "/internal/channel-input/respond";

export default defineChannel({
  routes: [
    POST(route, (request, { attachSession }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          const raw = yield* readAuthenticatedInternalCallback(request, route);
          if (raw instanceof Response) return raw;
          const input = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(internalCallbackBodies[route]),
            { onExcessProperty: "error" }
          )(raw.toString("utf8"));
          yield* submitChannelResponse(input, attachSession(input.sessionId));
          return Response.json(
            { status: "accepted", requestId: input.requestId },
            { status: 202 }
          );
        }).pipe(
          Effect.catchTags({
            InternalCallbackRejected: (error) =>
              Effect.succeed(new Response(null, { status: error.status })),
            SchemaError: () =>
              Effect.succeed(new Response(null, { status: 400 })),
            ChannelResponseRejected: () =>
              Effect.succeed(new Response(null, { status: 409 })),
            ChannelResponseUncertain: () =>
              Effect.succeed(new Response(null, { status: 503 })),
            ChannelTransportError: () =>
              Effect.succeed(new Response(null, { status: 401 })),
            IdentityInactive: () =>
              Effect.succeed(new Response(null, { status: 401 })),
            InvalidMessage: () =>
              Effect.succeed(new Response(null, { status: 409 })),
            TimeoutError: () =>
              Effect.succeed(new Response(null, { status: 503 })),
          }),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnv()
          )
        ),
        { signal: request.signal }
      )
    ),
  ],
});
