import { Config, DateTime, Effect } from "effect";
import { defineChannel, POST, type ChannelDefinition } from "eve/channels";

import { ChannelAccounts, type Identity } from "../../server/accounts";
import { ChannelAuthPrompts } from "../../server/channel-auth/prompts";
import {
  dispatchAuthPrompt,
  dispatchItem,
} from "../../server/channels/dispatch";
import { Kapso } from "../../server/channels/kapso";
import { Telegram } from "../../server/channels/telegram";
import { ChannelTransport } from "../../server/channels/transport";
import { readVerifiedWebhook } from "../../server/channels/webhook";
import { Messaging, type Lease } from "../../server/messaging";
import { serverRuntime } from "../../server/runtime";
import { drainChannelInbox, handoffChannelMessage } from "./channel-session";
import { privateChannelEvents } from "./private-channel-events";

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
            const accounts = yield* ChannelAccounts;
            const messaging = yield* Messaging;
            const identities = new Map<string, Identity>();
            const prompts: string[] = [];

            for (const event of events) {
              const sender = {
                channel: event.channel,
                installationId: event.installationId,
                senderId: event.senderId,
              };

              if (event.kind === "command") {
                if (event.command === "start") {
                  const authPrompts = yield* ChannelAuthPrompts;

                  const prompt = yield* authPrompts.prepare({
                    token: event.token,
                    sender,
                    eventId: event.eventId,
                  });

                  prompts.push(prompt.challengeId);
                } else {
                  yield* accounts.confirmChallenge({
                    token: event.token,
                    sender,
                  });
                }
              } else {
                const identity = yield* accounts.resolveVerifiedSender(sender);
                yield* messaging.accept({
                  identityId: identity.id,
                  eventId: event.eventId,
                  sourceMessageId: event.messageId,
                  payload: {
                    ...event.payload,
                    sourceOccurredAtMs: DateTime.toEpochMillis(
                      DateTime.makeUnsafe(event.occurredAt)
                    ),
                  },
                });
                identities.set(identity.id, identity);
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
              ProviderInputError: () =>
                Effect.succeed(new Response("invalid event", { status: 400 })),
              ChannelAccountError: () =>
                Effect.succeed(
                  new Response("invalid challenge or identity", { status: 400 })
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
