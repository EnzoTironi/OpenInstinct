import { ConfigProvider, Effect, Schema } from "effect";
import { defineChannel, POST } from "eve/channels";

import {
  internalCallbackBodies,
  readAuthenticatedInternalCallback,
} from "../../server/internal/callback-auth";
import { serverRuntime } from "../../server/runtime";
import { submitChannelResponse } from "../lib/channel-response";

const route = "/internal/channel-input/respond";

const decodeSchema_fromJsonString_internalCallbackBodies_route =
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(internalCallbackBodies[route]),
    { onExcessProperty: "error" }
  );

function responseWithStatus(status: number) {
  return Effect.succeed(new Response(null, { status }));
}

const channelInputCatchTags = {
  InternalCallbackRejected: (error: { readonly status: number }) =>
    responseWithStatus(error.status),
  SchemaError: () => responseWithStatus(400),
  ChannelResponseRejected: () => responseWithStatus(409),
  ChannelResponseUncertain: () => responseWithStatus(503),
  ChannelTransportError: () => responseWithStatus(401),
  IdentityInactive: () => responseWithStatus(401),
  InvalidMessage: () => responseWithStatus(409),
  TimeoutError: () => responseWithStatus(503),
} as const;

const handleChannelInputRespond = Effect.fn("handleChannelInputRespond")(
  function* (
    request: Request,
    attachSession: Parameters<Parameters<typeof POST>[1]>[1]["attachSession"]
  ) {
    const raw = yield* readAuthenticatedInternalCallback(request, route);

    if (raw instanceof Response) return raw;

    const input =
      yield* decodeSchema_fromJsonString_internalCallbackBodies_route(
        raw.toString("utf8")
      );

    yield* submitChannelResponse(input, attachSession(input.sessionId));

    return Response.json(
      { status: "accepted", requestId: input.requestId },
      { status: 202 }
    );
  }
);

export default defineChannel({
  routes: [
    POST(route, (request, { attachSession }) =>
      serverRuntime.runPromise(
        handleChannelInputRespond(request, attachSession).pipe(
          Effect.catchTags(channelInputCatchTags),
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
