import { renderChannelInput } from "./channel-input";
import { taskReportDeliveryId } from "./task-report";
import { channelConsentRevision } from "./channel-consent";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { ChannelEvents } from "eve/channels";
import type { Identity } from "../../server/accounts";
import { ChannelTransport } from "../../server/channels/transport";
import { serverRuntime } from "../../server/runtime";
import { requireChannelPrincipal } from "../../server/channels/principal";

export function privateChannelEvents(channel: Identity["channel"]) {
  const terminal = (
    ...[event, _channel, context]: Parameters<
      NonNullable<ChannelEvents<unknown>["turn.cancelled"]>
    >
  ) => {
    if (context.session.parent) return Promise.resolve();
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
          deliveryKey: `turn-status:${context.session.id}:${event.turnId}`,
          text: "This turn ended before completion.",
        });
      })
    );
  };
  return {
    "message.completed": (event, _channel, context) => {
      const text = event.message;
      if (
        context.session.parent ||
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
          const reportId = taskReportDeliveryId(context);
          const enqueue = reportId
            ? transport.enqueueTaskReport
            : transport.enqueueText;
          yield* enqueue({
            identityId: identity.id,
            deliveryKey:
              reportId ??
              `message:${context.session.id}:${event.turnId}:${String(event.stepIndex)}:${String(event.sequence)}`,
            text,
          });
          yield* transport.drainOutbox(identity.id);
        })
      );
    },
    "input.requested": (event, _channel, context) =>
      enqueueInput(channel, event, context),
    "authorization.required": (event, _channel, context) =>
      enqueueAuthorization(channel, event, context),
    "turn.failed": terminal,
    "turn.cancelled": terminal,
  } satisfies Pick<
    ChannelEvents<unknown>,
    | "message.completed"
    | "authorization.required"
    | "input.requested"
    | "turn.failed"
    | "turn.cancelled"
  >;
}

function enqueueAuthorization(
  channel: Identity["channel"],
  event: Parameters<
    NonNullable<ChannelEvents<unknown>["authorization.required"]>
  >[0],
  context: Parameters<
    NonNullable<ChannelEvents<unknown>["authorization.required"]>
  >[2]
) {
  if (context.session.parent) return Promise.resolve();
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

function enqueueInput(
  channel: Identity["channel"],
  event: Parameters<NonNullable<ChannelEvents<unknown>["input.requested"]>>[0],
  context: Parameters<NonNullable<ChannelEvents<unknown>["input.requested"]>>[2]
) {
  if (context.session.parent) return Promise.resolve();
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const identity = yield* requireChannelPrincipal(
        channel,
        context.session.auth.current ?? context.session.auth.initiator ?? null
      );
      const transport = yield* ChannelTransport;
      for (const request of event.requests) {
        yield* transport.enqueueText({
          identityId: identity.id,
          deliveryKey: `input:${context.session.id}:${request.requestId}`,
          text: renderChannelInput(request),
          inputRequest: {
            sessionId: context.session.id,
            requestId: request.requestId,
            revision: channelConsentRevision(request),
          },
        });
      }
      yield* transport.drainOutbox(identity.id);
    })
  );
}
