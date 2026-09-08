import { Config, Effect } from "effect";
import { ChannelAuthPrompts } from "../channel-auth/prompts";
import { Telegram } from "./telegram";
import { Kapso } from "./kapso";
import { ProviderInputError } from "./provider-errors";

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

export const dispatchAuthPrompt = Effect.fn("dispatchAuthPrompt")(function* (
  challengeId: string
) {
  const prompts = yield* ChannelAuthPrompts;
  const claim = yield* prompts.claim(challengeId);
  if (!claim) return;
  const send = Effect.gen(function* () {
    const installation = yield* Config.string(
      claim.channel === "telegram" ? "TELEGRAM_BOT_ID" : "KAPSO_PHONE_NUMBER_ID"
    );
    if (installation !== claim.installationId)
      return yield* new ProviderInputError({
        provider: claim.channel,
        reason: "wrong_installation",
      });
    const provider =
      claim.channel === "telegram" ? yield* Telegram : yield* Kapso;
    yield* prompts.checkLease(claim.lease);
    return yield* provider.sendLoginConfirmation(claim.senderId, claim.token);
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
