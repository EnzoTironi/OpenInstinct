import { Config, Effect } from "effect";
import { ChannelAuthPrompts } from "../channel-auth/prompts";
import { Telegram } from "./telegram";
import { ProviderInputError } from "./provider-errors";
import type { InboundEvent } from "./inbound";

export const dispatchItem = Effect.fn("dispatchItem")(function* <
  A,
  E extends Error,
  R,
>(itemId: string, operation: Effect.Effect<A, E, R>) {
  yield* operation.pipe(
    Effect.catch((error) =>
      Effect.logError("Channel dispatch item failed", {
        itemId,
        errorType: error.name,
      })
    )
  );
});

export const dispatchAuthFeedback = Effect.fn("dispatchAuthFeedback")(
  function* (
    event: Extract<InboundEvent, { kind: "command" }>,
    confirmed: boolean,
    refusalMessage?: string
  ) {
    const refusal =
      refusalMessage ??
      "This request cannot be confirmed here. Return to your original Zoen browser tab to check it or start a new request.";
    if (event.channel !== "telegram") return;
    const provider = yield* Telegram;
    if (event.command === "start") {
      yield* provider.sendText(event.chatId, refusal);
      return;
    }
    if (!event.callbackQueryId) return;
    // The database outcome stands even if Telegram can no longer show the toast.
    yield* dispatchItem(
      event.eventId,
      provider.answerCallbackQuery(
        event.callbackQueryId,
        confirmed
          ? "Confirmed. Return to your original Zoen browser tab to finish."
          : refusal,
        !confirmed
      )
    );
    if (confirmed) {
      yield* provider.editLoginConfirmation(event.chatId, event.messageId);
    }
  }
);

export const dispatchAuthPrompt = Effect.fn("dispatchAuthPrompt")(function* (
  challengeId: string
) {
  const prompts = yield* ChannelAuthPrompts;
  const claim = yield* prompts.claim(challengeId);
  if (!claim) return;
  const send = Effect.gen(function* () {
    if (claim.channel !== "telegram")
      return yield* new ProviderInputError({
        provider: claim.channel,
        reason: "invalid_command",
      });
    const installation = yield* Config.string("TELEGRAM_BOT_ID");
    if (installation !== claim.installationId)
      return yield* new ProviderInputError({
        provider: claim.channel,
        reason: "wrong_installation",
      });
    const provider = yield* Telegram;
    yield* prompts.checkLease(claim.lease);
    return yield* provider.sendLoginConfirmation(
      claim.senderId,
      claim.token,
      claim.purpose
    );
  });
  yield* send.pipe(
    Effect.flatMap((result) =>
      prompts.markSent(claim.lease, result.providerMessageId)
    ),
    Effect.catchTags({
      ProviderRejected: () => prompts.markRejected(claim.lease),
      ProviderUncertain: () => prompts.markUncertain(claim.lease),
      ProviderInputError: () => prompts.markRejected(claim.lease),
      ConfigError: () => prompts.markRejected(claim.lease),
    })
  );
});

export const drainAuthPrompts = Effect.gen(function* () {
  const prompts = yield* ChannelAuthPrompts;
  const pending = yield* prompts.pending(25);
  yield* Effect.forEach(
    pending,
    (id) => dispatchItem(id, dispatchAuthPrompt(id)),
    {
      concurrency: 4,
      discard: true,
    }
  );
});
