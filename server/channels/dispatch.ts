import { Config, Effect } from "effect";

import { ChannelAuthPrompts } from "../channel-auth/prompts";
import { ProviderInputError } from "./provider-errors";
import { Telegram } from "./telegram";

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

interface AuthPromptClaim {
  readonly channel: "kapso" | "telegram";
  readonly installationId: string;
  readonly senderId: string;
  readonly token: string;
  readonly lease: {
    readonly challengeId: string;
    readonly leaseToken: string;
  };
}

const sendTelegramAuthPrompt = Effect.fn("sendTelegramAuthPrompt")(function* (
  claim: AuthPromptClaim
) {
  if (claim.channel !== "telegram") {
    return yield* new ProviderInputError({
      provider: claim.channel,
      reason: "invalid_command",
    });
  }

  const installation = yield* Config.string("TELEGRAM_BOT_ID");

  if (installation !== claim.installationId) {
    return yield* new ProviderInputError({
      provider: claim.channel,
      reason: "wrong_installation",
    });
  }

  const prompts = yield* ChannelAuthPrompts;
  const provider = yield* Telegram;
  yield* prompts.checkLease(claim.lease);

  return yield* provider.sendLoginConfirmation(claim.senderId, claim.token);
});

const settleAuthPromptSuccess = Effect.fn("settleAuthPromptSuccess")(function* (
  lease: AuthPromptClaim["lease"],
  result: { readonly providerMessageId: string }
) {
  const prompts = yield* ChannelAuthPrompts;

  return yield* prompts.markSent(lease, result.providerMessageId);
});

const settleAuthPromptRejected = Effect.fn("settleAuthPromptRejected")(
  function* (lease: AuthPromptClaim["lease"]) {
    const prompts = yield* ChannelAuthPrompts;

    return yield* prompts.markRejected(lease);
  }
);

const settleAuthPromptUncertain = Effect.fn("settleAuthPromptUncertain")(
  function* (lease: AuthPromptClaim["lease"]) {
    const prompts = yield* ChannelAuthPrompts;

    return yield* prompts.markUncertain(lease);
  }
);

export const dispatchAuthPrompt = Effect.fn("dispatchAuthPrompt")(function* (
  challengeId: string
) {
  const prompts = yield* ChannelAuthPrompts;
  const claim = yield* prompts.claim(challengeId);

  if (!claim) return;

  yield* sendTelegramAuthPrompt(claim).pipe(
    Effect.flatMap((result) => settleAuthPromptSuccess(claim.lease, result)),
    Effect.catchTags({
      ProviderRejected: () => settleAuthPromptRejected(claim.lease),
      ProviderUncertain: () => settleAuthPromptUncertain(claim.lease),
      ProviderInputError: () => settleAuthPromptRejected(claim.lease),
      ConfigError: () => settleAuthPromptRejected(claim.lease),
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
