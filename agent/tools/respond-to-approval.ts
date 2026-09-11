import { Effect, Schema } from "effect";
import { defineTool } from "eve/tools";

import { requireChannelPrincipal } from "../../server/channels/principal";
import {
  InternalCallbackRejected,
  internalCallbackBodies,
} from "../../server/internal/callback-auth";
import { serverRuntime } from "../../server/runtime";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { postInternalRequest } from "../lib/internal-request";

const callback = internalCallbackBodies["/internal/channel-input/respond"];

export const inputSchema = Schema.Struct({
  requestId: callback.fields.requestId,
  decision: callback.fields.decision,
});

export default defineTool({
  description:
    "Submit the current user's explicit approval or cancellation of one pending proposal already delivered in this conversation. Resolve the reference from the conversation; ask for clarification when ambiguous. For a correction, cancel the old proposal and wait for confirmed cancellation before proposing a replacement. Acceptance of this submission does not confirm execution or cancellation. Never repeat an uncertain submission.",
  inputSchema: {
    "~standard": Schema.toStandardJSONSchemaV1(
      Schema.toStandardSchemaV1(inputSchema, {
        parseOptions: { onExcessProperty: "error" },
      })
    )["~standard"],
  },
  execute(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const auth = context.session.auth.current;

        const channel = yield* Schema.decodeUnknownEffect(
          channelProviderSchema
        )(auth?.attributes.conversationChannel);

        const identity = yield* requireChannelPrincipal(channel, auth);

        const body = yield* Schema.decodeUnknownEffect(callback, {
          onExcessProperty: "error",
        })({
          ...input,
          sessionId: context.session.id,
          turnId: context.session.turn.id,
          identityId: identity.id,
          sourceMessageId: auth?.attributes.sourceMessageId,
        });

        const response = yield* Effect.tryPromise({
          try: () =>
            postInternalRequest("/internal/channel-input/respond", body),
          catch: () => new InternalCallbackRejected({ status: 503 }),
        });

        if (response.status === 202) {
          return { status: "accepted" as const, requestId: input.requestId };
        }

        return {
          status: [400, 401, 403, 409, 422].includes(response.status)
            ? ("rejected" as const)
            : ("uncertain" as const),
          requestId: input.requestId,
        };
      }),
      { signal: context.abortSignal }
    );
  },
});
