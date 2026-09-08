import { readChannelInputs, resolveChannelInput } from "./channel-input";
import { Effect, Schedule, Schema } from "effect";
import type { ChannelReceiveContext, ChannelSendOptions } from "eve/channels";
import type { Identity } from "../../server/accounts";
import { Messaging, type Lease } from "../../server/messaging";
import { ChannelTransport } from "../../server/channels/transport";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { loadChannelContent } from "../../server/channels/media/content";
import { mediaFailureMessage } from "../../server/channels/media/policy";

class ChannelDispatchError extends Schema.TaggedError<ChannelDispatchError>()(
  "ChannelDispatchError",
  {
    reason: Schema.Literals([
      "unauthorized",
      "handoff_unknown",
      "unsupported_media",
      "invalid_response",
    ]),
  }
) {}

export const channelPrincipal = (
  identity: Identity,
  sourceMessageId?: string
) => {
  const principalId = `better-auth:${identity.userId}`;
  const attributes = {
    channelIdentityId: identity.id,
    conversationChannel: identity.channel,
    conversationId: identity.id,
    workspaceId: accessScopeForUser(principalId).workspaceId,
  };
  const principal = {
    attributes,
    authenticator: "verified-channel",
    principalId,
    principalType: "user",
  };
  if (!sourceMessageId) return principal;
  return { ...principal, attributes: { ...attributes, sourceMessageId } };
};

export const requireChannelPrincipal = Effect.fn("requireChannelPrincipal")(
  function* (channel: Identity["channel"], auth: ChannelSendOptions["auth"]) {
    if (!auth)
      return yield* new ChannelDispatchError({ reason: "unauthorized" });
    const identityId = yield* Schema.decodeUnknownEffect(
      Schema.String.check(Schema.isUUID())
    )(auth.attributes.channelIdentityId).pipe(
      Effect.mapError(
        () => new ChannelDispatchError({ reason: "unauthorized" })
      )
    );
    const transport = yield* ChannelTransport;
    const identity = yield* transport.activeIdentity(identityId, channel);
    const expected = channelPrincipal(identity);
    if (
      auth.principalType !== "user" ||
      auth.principalId !== expected.principalId ||
      auth.attributes.workspaceId !== expected.attributes.workspaceId ||
      auth.attributes.conversationChannel !== channel ||
      auth.attributes.conversationId !== identity.id
    )
      return yield* new ChannelDispatchError({ reason: "unauthorized" });
    return identity;
  }
);

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
    if (receipt.payload.text?.trim().startsWith("/responder")) {
      return yield* respondChannelInput(
        channel,
        lease,
        auth,
        context,
        receipt.payload.text
      );
    }
    const loaded = yield* loadChannelContent(identity, receipt.payload).pipe(
      Effect.catchTag("ChannelMediaError", (error) =>
        Effect.gen(function* () {
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
        })
      )
    );
    // Media I/O may outlive a revocation. Recheck authority and the lease before use.
    yield* requireChannelPrincipal(channel, auth);
    yield* messaging.checkInboxLease(lease);
    for (const [index, transcript] of loaded.transcripts.entries()) {
      const transport = yield* ChannelTransport;
      yield* transport.enqueueText({
        identityId: identity.id,
        deliveryKey: `transcript:${receipt.id}:${String(index)}`,
        text: `I heard: ${transcript}\nIf this is incorrect, send a correction.`,
      });
    }
    const principal = channelPrincipal(
      identity,
      receipt.sourceMessageId ?? undefined
    );
    // A claimed durable payload is authoritative; cross-channel caller text is not.
    yield* messaging.checkInboxLease(lease);
    const session = yield* Effect.tryPromise({
      try: () =>
        context.from(identity.id).send(loaded.content, {
          auth: principal,
          turnPolicy: "queue",
        }),
      catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
    }).pipe(
      Effect.flatMap((candidate) =>
        Effect.gen(function* () {
          const owner = yield* Effect.tryPromise({
            try: () => context.resolveSession(identity.id),
            catch: () =>
              new ChannelDispatchError({ reason: "handoff_unknown" }),
          }).pipe(
            Effect.repeat({
              while: (resolved) => !resolved,
              schedule: Schedule.spaced("100 millis"),
            })
          );
          if (owner.id !== candidate.id)
            return yield* new ChannelDispatchError({
              reason: "handoff_unknown",
            });
          return owner;
        })
      ),
      // Cold send returns a candidate before alias ownership commits. Keep the lane
      // leased until this exact candidate owns it; another owner is not acceptance proof.
      Effect.timeout("25 seconds"),
      Effect.catchTag(
        "TimeoutError",
        () => new ChannelDispatchError({ reason: "handoff_unknown" })
      ),
      Effect.tapError(() =>
        messaging.markInboxUncertain({
          lease,
          reason: "handoff_unknown",
        })
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
        error.reason === "unsupported_media" ||
        error.reason === "invalid_response"
          ? Effect.void
          : Effect.fail(error)
      )
    );
  }
});

const respondChannelInput = Effect.fn("respondChannelInput")(function* (
  channel: Identity["channel"],
  lease: Lease,
  auth: ChannelSendOptions["auth"],
  context: ChannelReceiveContext,
  text: string
) {
  const identity = yield* requireChannelPrincipal(channel, auth);
  const messaging = yield* Messaging;
  const owner = yield* Effect.tryPromise({
    try: () => context.resolveSession(identity.id),
    catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
  });
  const requests = owner
    ? yield* Effect.tryPromise({
        try: (signal) => readChannelInputs(owner, signal),
        catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
      }).pipe(
        Effect.timeout("8 seconds"),
        Effect.catchTag(
          "TimeoutError",
          () => new ChannelDispatchError({ reason: "handoff_unknown" })
        )
      )
    : [];
  const response = owner ? resolveChannelInput(owner.id, text, requests) : null;
  if (!owner || !response) {
    const transport = yield* ChannelTransport;
    yield* transport.enqueueText({
      identityId: identity.id,
      deliveryKey: `input-invalid:${lease.id}`,
      text: "Essa resposta não corresponde a uma solicitação pendente. Use o comando completo exibido na solicitação.",
    });
    yield* messaging.markInboxFailed({ lease, reason: "adapter_rejected" });
    return yield* new ChannelDispatchError({ reason: "invalid_response" });
  }
  yield* requireChannelPrincipal(channel, auth);
  const receipt = yield* messaging.checkInboxLease(lease);
  const current = yield* Effect.tryPromise({
    try: () => context.resolveSession(identity.id),
    catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
  });
  if (current?.id !== owner.id)
    return yield* new ChannelDispatchError({ reason: "handoff_unknown" });
  const result = yield* Effect.tryPromise({
    try: () =>
      owner.respond([response], {
        auth: channelPrincipal(identity, receipt.sourceMessageId ?? undefined),
      }),
    catch: () => new ChannelDispatchError({ reason: "handoff_unknown" }),
  }).pipe(
    Effect.tapError(() =>
      messaging.markInboxUncertain({ lease, reason: "handoff_unknown" })
    )
  );
  if (result.status !== "accepted")
    return yield* new ChannelDispatchError({ reason: "handoff_unknown" });
  yield* messaging.markAccepted({
    lease,
    receipt: { status: "accepted", sessionId: owner.id },
  });
  return owner;
});
