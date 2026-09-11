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

const decodeNativeInboxContentSchema = Schema.decodeUnknownEffect(
  NativeInboxContentSchema
);

function handoffUnknown() {
  return new ChannelDispatchError({ reason: "handoff_unknown" });
}

const catchHandoffUnknown = () => handoffUnknown();

function snapshotMatchesPrincipal(input: {
  readonly channel: Identity["channel"];
  readonly identityId: string;
  readonly principalId: string;
  readonly receiptId: string;
  readonly snapshot: {
    readonly address: string;
    readonly channel: Identity["channel"];
    readonly inputId: string;
    readonly principalId: string;
  };
}) {
  return (
    input.snapshot.inputId === input.receiptId &&
    input.snapshot.address === input.identityId &&
    input.snapshot.channel === input.channel &&
    input.snapshot.principalId === input.principalId
  );
}

function recoveredAcceptanceMatches(
  recovered: {
    readonly eventId: string;
    readonly inputId: string;
    readonly payloadDigest: string;
    readonly sessionId: string;
  },
  accepted: {
    readonly eventId: string;
    readonly inputId: string;
    readonly payloadDigest: string;
    readonly sessionId: string;
  }
) {
  return (
    recovered.inputId === accepted.inputId &&
    recovered.sessionId === accepted.sessionId &&
    recovered.eventId === accepted.eventId &&
    recovered.payloadDigest === accepted.payloadDigest
  );
}

const resumeAcceptedHandoff = Effect.fn("handoffChannelMessage.resumeAccepted")(
  function* (input: {
    readonly acceptedInput: NonNullable<
      Awaited<
        ReturnType<
          ReturnType<ChannelReceiveContext["from"]>["getInputAcceptance"]
        >
      >
    >;
    readonly address: ReturnType<ChannelReceiveContext["from"]>;
    readonly auth: ChannelSendOptions["auth"];
    readonly channel: Identity["channel"];
    readonly context: ChannelReceiveContext;
    readonly lease: Lease;
    readonly principal: ReturnType<typeof channelPrincipal>;
    readonly snapshot: {
      readonly content: unknown;
      readonly inputId: string;
    };
  }) {
    const messaging = yield* Messaging;
    const contentMissing = input.snapshot.content === null;

    const inputMismatch =
      input.acceptedInput.inputId !== input.snapshot.inputId;

    if (contentMissing || inputMismatch) {
      return yield* handoffUnknown();
    }

    yield* requireChannelPrincipal(input.channel, input.auth);
    yield* messaging.checkInboxLease(input.lease);

    const recovered = yield* Effect.tryPromise({
      try: () =>
        input.address.recoverInputAcceptance(
          input.snapshot.inputId,
          input.principal
        ),
      catch: catchHandoffUnknown,
    }).pipe(Effect.timeout("25 seconds"));

    if (!recovered) return yield* handoffUnknown();

    if (!recoveredAcceptanceMatches(recovered, input.acceptedInput)) {
      return yield* handoffUnknown();
    }

    return input.context.attachSession(recovered.sessionId);
  }
);

const handleUnsupportedMedia = Effect.fn(
  "dispatchChannelSession.unsupportedMedia"
)(function* (input: {
  readonly auth: ChannelSendOptions["auth"];
  readonly channel: Identity["channel"];
  readonly error: Parameters<typeof mediaFailureMessage>[0];
  readonly identityId: string;
  readonly lease: Lease;
  readonly receiptId: string;
}) {
  const messaging = yield* Messaging;
  yield* requireChannelPrincipal(input.channel, input.auth);
  yield* messaging.checkInboxLease(input.lease);
  const transport = yield* ChannelTransport;
  yield* transport.enqueueText({
    identityId: input.identityId,
    deliveryKey: `unsupported:${input.receiptId}`,
    text: mediaFailureMessage(input.error),
  });
  yield* messaging.markInboxFailed({
    lease: input.lease,
    reason: "adapter_rejected",
  });

  return yield* new ChannelDispatchError({ reason: "unsupported_media" });
});

const prepareMissingContent = Effect.fn(
  "handoffChannelMessage.prepareMissingContent"
)(function* (input: {
  readonly auth: ChannelSendOptions["auth"];
  readonly channel: Identity["channel"];
  readonly identity: Identity;
  readonly lease: Lease;
  readonly receipt: {
    readonly id: string;
    readonly payload: Parameters<typeof loadChannelContent>[1];
  };
}) {
  const messaging = yield* Messaging;

  const loaded = yield* loadChannelContent(
    input.identity,
    input.receipt.payload,
    input.receipt.id
  ).pipe(
    Effect.catchTag("ChannelMediaError", (error) =>
      handleUnsupportedMedia({
        auth: input.auth,
        channel: input.channel,
        error,
        identityId: input.identity.id,
        lease: input.lease,
        receiptId: input.receipt.id,
      })
    )
  );

  yield* requireChannelPrincipal(input.channel, input.auth);
  yield* messaging.checkInboxLease(input.lease);

  const prepared = yield* messaging.prepareInboxHandoff({
    lease: input.lease,
    transcripts: loaded.transcripts,
    content: yield* decodeNativeInboxContentSchema(loaded.content),
  });

  return prepared.content;
});

const verifyAttachment = Effect.fn("dispatchChannelSession.verifyAttachment")(
  function* (input: {
    readonly attachment: { readonly id: string };
    readonly identityId: string;
    readonly sourceInboxId: string;
  }) {
    const artifacts = yield* Artifacts;

    const artifact = yield* artifacts.readForSource({
      identityId: input.identityId,
      sourceInboxId: input.sourceInboxId,
      mediaId: input.attachment.id,
    });

    if (!artifact) return yield* handoffUnknown();

    return yield* Effect.void;
  }
);

const verifyAttachmentsIfPresent = Effect.fn(
  "handoffChannelMessage.verifyAttachments"
)(function* (input: {
  readonly identityId: string;
  readonly receipt: {
    readonly id: string;
    readonly payload: {
      readonly attachments?: readonly { readonly id: string }[];
    };
  };
}) {
  const attachments = input.receipt.payload.attachments;

  if (!attachments?.length) return;

  yield* Effect.forEach(
    attachments,
    (attachment) =>
      verifyAttachment({
        attachment,
        identityId: input.identityId,
        sourceInboxId: input.receipt.id,
      }),
    { concurrency: 1, discard: true }
  );
});

const sendFreshHandoff = Effect.fn("handoffChannelMessage.sendFresh")(
  function* (input: {
    readonly address: ReturnType<ChannelReceiveContext["from"]>;
    readonly auth: ChannelSendOptions["auth"];
    readonly channel: Identity["channel"];
    readonly content: typeof NativeInboxContentSchema.Type;
    readonly lease: Lease;
    readonly principal: ReturnType<typeof channelPrincipal>;
    readonly snapshotInputId: string;
  }) {
    const messaging = yield* Messaging;
    yield* requireChannelPrincipal(input.channel, input.auth);
    yield* messaging.checkInboxLease(input.lease);

    const sent = yield* Effect.tryPromise({
      try: () =>
        input.address.send(
          Schema.is(Schema.NonEmptyString)(input.content)
            ? input.content
            : [...input.content],
          {
            auth: input.principal,
            inputId: input.snapshotInputId,
            turnPolicy: "queue",
          }
        ),
      catch: catchHandoffUnknown,
    }).pipe(Effect.timeout("25 seconds"));

    const accepted =
      sent.acceptedInput &&
      sent.acceptedInput.inputId === input.snapshotInputId &&
      sent.acceptedInput.sessionId === sent.id;

    if (!accepted) return yield* handoffUnknown();

    return sent;
  }
);

const openOrResumeSession = Effect.fn("handoffChannelMessage.openOrResume")(
  function* (input: {
    readonly address: ReturnType<ChannelReceiveContext["from"]>;
    readonly auth: ChannelSendOptions["auth"];
    readonly channel: Identity["channel"];
    readonly context: ChannelReceiveContext;
    readonly identity: Identity;
    readonly lease: Lease;
    readonly principal: ReturnType<typeof channelPrincipal>;
    readonly receipt: {
      readonly id: string;
      readonly payload: Parameters<typeof loadChannelContent>[1] & {
        readonly attachments?: readonly { readonly id: string }[];
      };
    };
    readonly snapshot: {
      readonly content: typeof NativeInboxContentSchema.Type | null;
      readonly inputId: string;
    };
  }) {
    // Native acceptance must be checked before media access: an accepted input may
    // outlive its source artifact, and a missing artifact is not evidence of rejection.
    const acceptedInput = yield* Effect.tryPromise({
      try: () =>
        input.address.getInputAcceptance(
          input.snapshot.inputId,
          input.principal
        ),
      catch: catchHandoffUnknown,
    }).pipe(Effect.timeout("25 seconds"));

    if (acceptedInput) {
      return yield* resumeAcceptedHandoff({
        acceptedInput,
        address: input.address,
        auth: input.auth,
        channel: input.channel,
        context: input.context,
        lease: input.lease,
        principal: input.principal,
        snapshot: input.snapshot,
      });
    }

    // Only a successful lookup returning absence permits preparation or another send.
    const messaging = yield* Messaging;
    yield* requireChannelPrincipal(input.channel, input.auth);
    yield* messaging.checkInboxLease(input.lease);
    let content = input.snapshot.content;

    if (content === null) {
      content = yield* prepareMissingContent({
        auth: input.auth,
        channel: input.channel,
        identity: input.identity,
        lease: input.lease,
        receipt: input.receipt,
      });
    } else {
      yield* verifyAttachmentsIfPresent({
        identityId: input.identity.id,
        receipt: input.receipt,
      });
    }

    return yield* sendFreshHandoff({
      address: input.address,
      auth: input.auth,
      channel: input.channel,
      content,
      lease: input.lease,
      principal: input.principal,
      snapshotInputId: input.snapshot.inputId,
    });
  }
);

const markUncertainOnHandoffUnknown = Effect.fn(
  "handoffChannelMessage.markUncertain"
)(function* (lease: Lease, error: ChannelDispatchError) {
  if (error.reason !== "handoff_unknown") return;

  const messaging = yield* Messaging;
  yield* messaging.markInboxUncertain({ lease, reason: "handoff_unknown" });
});

export const handoffChannelMessage = Effect.fn("handoffChannelMessage")(
  function* (
    channel: Identity["channel"],
    lease: Lease,
    auth: ChannelSendOptions["auth"],
    context: ChannelReceiveContext
  ) {
    const identity = yield* requireChannelPrincipal(channel, auth);

    if (lease.identityId !== identity.id) {
      return yield* new ChannelDispatchError({ reason: "unauthorized" });
    }

    const messaging = yield* Messaging;
    const receipt = yield* messaging.checkInboxLease(lease);
    const snapshot = receipt.nativeInput;

    const principal = channelPrincipal(
      identity,
      receipt.sourceMessageId ?? undefined
    );

    if (!snapshot) return yield* handoffUnknown();

    if (
      !snapshotMatchesPrincipal({
        channel,
        identityId: identity.id,
        principalId: principal.principalId,
        receiptId: receipt.id,
        snapshot,
      })
    ) {
      return yield* handoffUnknown();
    }

    const address = context.from(snapshot.address);

    const session = yield* openOrResumeSession({
      address,
      auth,
      channel,
      context,
      identity,
      lease,
      principal,
      receipt,
      snapshot,
    }).pipe(
      Effect.catchTag("TimeoutError", () => handoffUnknown()),
      Effect.tapErrorTag("ChannelDispatchError", (error) =>
        markUncertainOnHandoffUnknown(lease, error)
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

  let drainStopped = false;
  yield* Effect.forEach(
    Array.from({ length: 8 }, (_, index) => index),
    Effect.fn("drainChannelInbox.attempt")(function* () {
      if (drainStopped) return;

      const claim = yield* messaging.claimInbox({
        identityId: identity.id,
        leaseSeconds: 150,
      });

      if (!claim) {
        drainStopped = true;

        return;
      }

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
          error.reason === "unsupported_media"
            ? Effect.void
            : Effect.fail(error)
        )
      );
    }),
    { concurrency: 1, discard: true }
  );
});
