import { Effect, Schema } from "effect";
import type { ChannelReceiveContext, ChannelSendOptions } from "eve/channels";

import type { Identity } from "../../server/accounts";
import { Artifacts } from "../../server/artifacts";
import { loadChannelContent } from "../../server/channels/media/content";
import { mediaFailureMessage } from "../../server/channels/media/policy";
import {
  ChannelDispatchError,
  channelPrincipal,
  requireChannelPrincipal,
} from "../../server/channels/principal";
import { ChannelTransport } from "../../server/channels/transport";
import {
  Messaging,
  NativeInboxContentSchema,
  type Lease,
} from "../../server/messaging";

export const handoffChannelMessage = Effect.fn("handoffChannelMessage")(
  function* (
    channel: Identity["channel"],
    lease: Lease,
    auth: ChannelSendOptions["auth"],
    context: ChannelReceiveContext
  ) {
    const identity = yield* requireChannelPrincipal(channel, auth);

    if (lease.identityId !== identity.id)
      return yield* new ChannelDispatchError({ reason: "unauthorized" });
    const messaging = yield* Messaging;
    const receipt = yield* messaging.checkInboxLease(lease);
    const snapshot = receipt.nativeInput;

    const principal = channelPrincipal(
      identity,
      receipt.sourceMessageId ?? undefined
    );

    if (
      !snapshot ||
      snapshot.inputId !== receipt.id ||
      snapshot.address !== identity.id ||
      snapshot.channel !== channel ||
      snapshot.principalId !== principal.principalId
    )
      return yield* new ChannelDispatchError({ reason: "handoff_unknown" });
    const address = context.from(snapshot.address);

    const session = yield* Effect.gen(function* () {
      // Native acceptance must be checked before media access: an accepted input may
      // outlive its source artifact, and a missing artifact is not evidence of rejection.
      const acceptedInput = yield* Effect.tryPromise({
        try: () => address.getInputAcceptance(snapshot.inputId, principal),
        catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
      }).pipe(Effect.timeout("25 seconds"));

      if (acceptedInput) {
        if (
          snapshot.content === null ||
          acceptedInput.inputId !== snapshot.inputId
        )
          return yield* new ChannelDispatchError({ reason: "handoff_unknown" });
        yield* requireChannelPrincipal(channel, auth);
        yield* messaging.checkInboxLease(lease);

        const recovered = yield* Effect.tryPromise({
          try: () =>
            address.recoverInputAcceptance(snapshot.inputId, principal),
          catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
        }).pipe(Effect.timeout("25 seconds"));

        if (
          !recovered ||
          recovered.inputId !== acceptedInput.inputId ||
          recovered.sessionId !== acceptedInput.sessionId ||
          recovered.eventId !== acceptedInput.eventId ||
          recovered.payloadDigest !== acceptedInput.payloadDigest
        )
          return yield* new ChannelDispatchError({ reason: "handoff_unknown" });

        return context.attachSession(recovered.sessionId);
      }

      // Only a successful lookup returning absence permits preparation or another send.
      yield* requireChannelPrincipal(channel, auth);
      yield* messaging.checkInboxLease(lease);
      let content = snapshot.content;

      if (content === null) {
        const loaded = yield* loadChannelContent(
          identity,
          receipt.payload,
          receipt.id
        ).pipe(
          Effect.catchTag(
            "ChannelMediaError",
            Effect.fn("dispatchChannelSession.unsupportedMedia")(
              function* (error) {
                yield* requireChannelPrincipal(channel, auth);
                yield* messaging.checkInboxLease(lease);
                const transport = yield* ChannelTransport;
                yield* transport.enqueueText({
                  identityId: identity.id,
                  deliveryKey: `unsupported:${receipt.id}`,
                  text: mediaFailureMessage(error),
                });
                yield* messaging.markInboxFailed({
                  lease,
                  reason: "adapter_rejected",
                });

                return yield* new ChannelDispatchError({
                  reason: "unsupported_media",
                });
              }
            )
          )
        );

        yield* requireChannelPrincipal(channel, auth);
        yield* messaging.checkInboxLease(lease);

        const prepared = yield* messaging.prepareInboxHandoff({
          lease,
          transcripts: loaded.transcripts,
          content: yield* Schema.decodeUnknownEffect(NativeInboxContentSchema)(
            loaded.content
          ),
        });

        content = prepared.content;
      } else if (receipt.payload.attachments?.length) {
        const artifacts = yield* Artifacts;

        for (const attachment of receipt.payload.attachments) {
          const artifact = yield* artifacts.readForSource({
            identityId: identity.id,
            sourceInboxId: receipt.id,
            mediaId: attachment.id,
          });

          if (!artifact)
            return yield* new ChannelDispatchError({
              reason: "handoff_unknown",
            });
        }
      }

      yield* requireChannelPrincipal(channel, auth);
      yield* messaging.checkInboxLease(lease);

      const sent = yield* Effect.tryPromise({
        try: () =>
          address.send(
            Schema.is(Schema.NonEmptyString)(content) ? content : [...content],
            {
              auth: principal,
              inputId: snapshot.inputId,
              turnPolicy: "queue",
            }
          ),
        catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
      }).pipe(Effect.timeout("25 seconds"));

      if (
        !sent.acceptedInput ||
        sent.acceptedInput.inputId !== snapshot.inputId ||
        sent.acceptedInput.sessionId !== sent.id
      )
        return yield* new ChannelDispatchError({ reason: "handoff_unknown" });

      return sent;
    }).pipe(
      Effect.catchTag(
        "TimeoutError",
        () => new ChannelDispatchError({ reason: "handoff_unknown" })
      ),
      Effect.tapErrorTag("ChannelDispatchError", (error) =>
        error.reason === "handoff_unknown"
          ? messaging.markInboxUncertain({ lease, reason: "handoff_unknown" })
          : Effect.void
      )
    );

    yield* messaging.markAccepted({
      lease,
      receipt: { status: "accepted", sessionId: session.id },
    });

    return session;
  }
);

export const drainChannelInbox = Effect.fn("drainChannelInbox")(function* (
  identity: Identity,
  context: ChannelReceiveContext
) {
  const messaging = yield* Messaging;

  for (let index = 0; index < 8; index++) {
    const claim = yield* messaging.claimInbox({
      identityId: identity.id,
      leaseSeconds: 150,
    });

    if (!claim) return;
    yield* handoffChannelMessage(
      identity.channel,
      {
        identityId: identity.id,
        id: claim.id,
        leaseToken: claim.leaseToken,
      },
      channelPrincipal(identity),
      context
    ).pipe(
      Effect.catchTag("ChannelDispatchError", (error) =>
        error.reason === "unsupported_media" ? Effect.void : Effect.fail(error)
      )
    );
  }
});
