import { Effect } from "effect";
import type { ChannelEvents } from "eve/channels";
import type { Identity } from "../../server/accounts";
import { ChannelTransport } from "../../server/channels/transport";
import { serverRuntime } from "../../server/runtime";
import { requireChannelPrincipal } from "./channel-session";

export function privateChannelEvents(channel: Identity["channel"]) {
  const terminal = (
    ...[event, _channel, context]: Parameters<
      NonNullable<ChannelEvents["turn.cancelled"]>
    >
  ) =>
    serverRuntime.runPromise(
      Effect.gen(function* () {
        const auth =
          context.session.auth.current ??
          context.session.auth.initiator ??
          null;
        const identity = yield* requireChannelPrincipal(channel, auth);
        const transport = yield* ChannelTransport;
        yield* transport.enqueueText({
          identityId: identity.id,
          deliveryKey: `turn-status:${context.session.id}:${event.turnId}`,
          text: "This turn ended before completion.",
        });
      })
    );
  return {
    "message.completed": (event, _channel, context) => {
      const text = event.message;
      if (
        !text?.trim() ||
        text.trim() === "DELIVERY_COMPLETE" ||
        event.finishReason === "tool-calls"
      )
        return Promise.resolve();
      return serverRuntime.runPromise(
        Effect.gen(function* () {
          const auth =
            context.session.auth.current ??
            context.session.auth.initiator ??
            null;
          const identity = yield* requireChannelPrincipal(channel, auth);
          const transport = yield* ChannelTransport;
          yield* transport.enqueueText({
            identityId: identity.id,
            deliveryKey: `message:${context.session.id}:${event.turnId}:${String(event.stepIndex)}:${String(event.sequence)}`,
            text,
          });
          yield* transport.drainOutbox(identity.id);
        })
      );
    },
    "turn.failed": terminal,
    "turn.cancelled": terminal,
  } satisfies Pick<
    ChannelEvents,
    "message.completed" | "turn.failed" | "turn.cancelled"
  >;
}
