import { Config, DateTime, Effect } from "effect";
import { defineChannel, POST, type ChannelDefinition } from "eve/channels";
import { ChannelAccounts, type Identity } from "../../server/accounts";
import { Messaging, type Lease } from "../../server/messaging";
import { ChannelAuthPrompts } from "../../server/channel-auth/prompts";
import { ChannelTransport } from "../../server/channels/transport";
import {
  dispatchAuthFeedback,
  dispatchAuthPrompt,
  dispatchItem,
  dispatchUnlinkedSenderPrompt,
  signInUrl,
  unlinkedSenderCopy,
} from "../../server/channels/dispatch";
import { bindGroupChannelIdentity } from "../../server/channels/group-policy";
import type { InboundEvent } from "../../server/channels/inbound";
import { Telegram } from "../../server/channels/telegram";
import { Kapso } from "../../server/channels/kapso";
import { readVerifiedWebhook } from "../../server/channels/webhook";
import { serverRuntime } from "../../server/runtime";
import { drainChannelInbox, handoffChannelMessage } from "./channel-session";
import { privateChannelEvents } from "./private-channel-events";
import type { ProviderInputError } from "../../server/channels/provider-errors";

type Acceptance =
  | { readonly status: "accepted"; readonly identity: Identity }
  | { readonly status: "unlinked"; readonly prompt: boolean };

const acceptChannelMessage = Effect.fn("acceptChannelMessage")(function* (
  event: Extract<InboundEvent, { kind: "message" }>
) {
  const accounts = yield* ChannelAccounts;
  const resolution = yield* accounts.resolveVerifiedSender({
    channel: event.channel,
    installationId: event.installationId,
    senderId: event.senderId,
  });
  if (resolution.status === "unlinked") {
    if (event.chatKind === "group")
      return { status: "unlinked", prompt: false } satisfies Acceptance;
    const contact = yield* accounts.recordUnlinkedContact(resolution.sender);
    return { status: "unlinked", prompt: contact.prompt } satisfies Acceptance;
  }
  const { identity } = resolution;
  const group =
    event.chatKind === "group"
      ? yield* bindGroupChannelIdentity({
          identityId: identity.id,
          channel: event.channel,
          installationId: event.installationId,
          senderId: event.senderId,
          chatId: event.chatId,
        })
      : undefined;
  const payload = {
    ...event.payload,
    sourceOccurredAtMs: DateTime.toEpochMillis(
      DateTime.makeUnsafe(event.occurredAt)
    ),
  };
  yield* (yield* Messaging).accept({
    identityId: identity.id,
    eventId: event.eventId,
    sourceMessageId: event.messageId,
    payload: group
      ? {
          ...payload,
          deliveryTargetId: group.deliveryTargetId,
          conversationScope: group.conversationScope,
        }
      : payload,
  });
  return { status: "accepted", identity } satisfies Acceptance;
});

function channelInputResponse(
  channel: Identity["channel"],
  error: ProviderInputError
) {
  if (
    channel === "telegram" &&
    ["invalid_command", "stale_event"].includes(error.reason)
  )
    return Effect.logInfo("Telegram update refused", {
      reason: error.reason,
    }).pipe(Effect.as(new Response("ignored")));
  return Effect.logWarning("Channel input rejected", {
    channel,
    reason: error.reason,
  }).pipe(
    Effect.as(
      new Response("invalid event", {
        status: error.reason === "configuration" ? 503 : 400,
      })
    )
  );
}

const acceptLoginCommand = Effect.fn("acceptLoginCommand")(
  function* (event: Extract<InboundEvent, { kind: "command" }>) {
    const sender = {
      channel: event.channel,
      installationId: event.installationId,
      senderId: event.senderId,
    };
    if (event.command === "confirm") {
      const accounts = yield* ChannelAccounts;
      yield* accounts.confirmChallenge({ token: event.token, sender });
      return { status: "confirmed" as const };
    }
    const authPrompts = yield* ChannelAuthPrompts;
    const prompt = yield* authPrompts.prepare({
      token: event.token,
      sender,
      eventId: event.eventId,
    });
    return { status: "prompt" as const, challengeId: prompt.challengeId };
  },
  (operation, event) =>
    operation.pipe(
      // Refused logins are terminal; provider retries must not block later messages.
      Effect.catchTag("ChannelAccountError", (error) =>
        Effect.logInfo("Channel login command refused", {
          channel: event.channel,
          command: event.command,
          reason: error.reason,
        }).pipe(Effect.as({ status: "refused" as const, reason: error.reason }))
      ),
      Effect.catchTag("ChannelAuthPromptError", (error) =>
        error.reason === "invalid_input" || error.reason === "conflict"
          ? Effect.logInfo("Channel login prompt refused", {
              channel: event.channel,
              reason: error.reason,
            }).pipe(Effect.as({ status: "refused" as const }))
          : Effect.fail(error)
      )
    )
);

export function privateChannel(channel: Identity["channel"]) {
  const definition: ChannelDefinition<undefined, void, Lease> = {
    turnPolicy: "queue",
    routes: [
      POST(`/channels/${channel}`, (request, context) =>
        serverRuntime.runPromise(
          Effect.gen(function* () {
            const secret = yield* Config.redacted(
              channel === "telegram"
                ? "TELEGRAM_WEBHOOK_SECRET"
                : "KAPSO_WEBHOOK_SECRET"
            );
            const body = yield* readVerifiedWebhook(request, channel, secret);
            const provider =
              channel === "telegram" ? yield* Telegram : yield* Kapso;
            const events = yield* provider.parse(body);
            const identities = new Map<string, Identity>();
            const prompts: string[] = [];
            for (const event of events) {
              if (event.kind === "command") {
                const result = yield* acceptLoginCommand(event);
                if (result.status === "prompt") {
                  prompts.push(result.challengeId);
                } else {
                  context.waitUntil(
                    serverRuntime.runPromise(
                      dispatchItem(
                        event.eventId,
                        Effect.gen(function* () {
                          const refusal =
                            result.status === "refused" &&
                            "reason" in result &&
                            result.reason === "sender_unlinked"
                              ? unlinkedSenderCopy(
                                  event.channel,
                                  yield* signInUrl(event.channel)
                                )
                              : undefined;
                          yield* dispatchAuthFeedback(
                            event,
                            result.status === "confirmed",
                            refusal
                          );
                        })
                      )
                    )
                  );
                }
              } else {
                const acceptance = yield* acceptChannelMessage(event);
                if (acceptance.status === "accepted") {
                  identities.set(acceptance.identity.id, acceptance.identity);
                } else if (acceptance.prompt) {
                  context.waitUntil(
                    serverRuntime.runPromise(
                      dispatchItem(
                        event.eventId,
                        dispatchUnlinkedSenderPrompt(event)
                      )
                    )
                  );
                }
              }
            }
            // Both ordinary inputs and login prompts are durable before ACK.
            context.waitUntil(
              serverRuntime.runPromise(
                Effect.gen(function* () {
                  yield* Effect.forEach(
                    prompts,
                    (id) => dispatchItem(id, dispatchAuthPrompt(id)),
                    {
                      concurrency: 4,
                      discard: true,
                    }
                  );
                  yield* Effect.forEach(
                    [...identities.values()],
                    (identity) =>
                      dispatchItem(
                        identity.id,
                        Effect.gen(function* () {
                          yield* dispatchItem(
                            identity.id,
                            drainChannelInbox(identity, context)
                          );
                          const transport = yield* ChannelTransport;
                          yield* transport.drainOutbox(identity.id);
                        })
                      ),
                    { concurrency: 4, discard: true }
                  );
                })
              )
            );
            return new Response("ok");
          }).pipe(
            Effect.catchTags({
              WebhookRejected: (error) =>
                Effect.succeed(
                  new Response("rejected", { status: error.status })
                ),
              ProviderInputError: (error) =>
                channelInputResponse(channel, error),
              ChannelAccountError: () =>
                Effect.succeed(
                  new Response("invalid challenge or identity", {
                    status: 400,
                  })
                ),
              PayloadConflict: () =>
                Effect.succeed(
                  new Response("conflicting replay", { status: 409 })
                ),
            }),
            Effect.catch((error) =>
              Effect.logError("Channel acceptance failed", {
                tag: error.name,
              }).pipe(Effect.as(new Response("unavailable", { status: 503 })))
            )
          )
        )
      ),
    ],
    receive: ({ target, auth }, context) =>
      serverRuntime.runPromise(
        handoffChannelMessage(channel, target, auth, context)
      ),
    events: privateChannelEvents(channel),
  };
  return defineChannel(definition);
}
