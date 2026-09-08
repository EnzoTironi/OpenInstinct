import { createHash } from "node:crypto";
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
    "authorization.required": (event, _channel, context) =>
      enqueueAuthorization(channel, event, context),
    "turn.failed": terminal,
    "turn.cancelled": terminal,
  } satisfies Pick<
    ChannelEvents,
    | "message.completed"
    | "authorization.required"
    | "turn.failed"
    | "turn.cancelled"
  >;
}

function enqueueAuthorization(
  channel: Identity["channel"],
  event: Parameters<NonNullable<ChannelEvents["authorization.required"]>>[0],
  context: Parameters<NonNullable<ChannelEvents["authorization.required"]>>[2]
) {
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const auth =
        context.session.auth.current ?? context.session.auth.initiator ?? null;
      const identity = yield* requireChannelPrincipal(channel, auth);
      const transport = yield* ChannelTransport;
      const challenge = event.authorization;
      const text = [
        `Connect ${challenge?.displayName ?? event.name}`,
        event.description,
        challenge?.instructions,
        challenge?.userCode ? `Code: ${challenge.userCode}` : undefined,
        challenge?.url,
      ]
        .filter((line) => line !== undefined)
        .join("\n\n");
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            context.session.id,
            event.turnId,
            event.stepIndex,
            event.name,
            event.attemptId ?? event.sequence,
          ])
        )
        .digest("hex");
      yield* transport.enqueueText({
        identityId: identity.id,
        deliveryKey: `authorization:${key}`,
        text,
      });
    })
  );
}
