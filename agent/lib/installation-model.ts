import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Config, Effect, Redacted, Schema } from "effect";
import { chatgpt } from "eve/models/openai";

export const installationModel = Effect.gen(function* () {
  const provider = yield* Config.literals(
    ["gateway", "openrouter-free", "codex-local"],
    "COMPANION_MODEL_PROVIDER"
  ).pipe(Config.withDefault("gateway"));

  if (provider === "gateway") return null;

  if (provider === "codex-local")
    return {
      model: chatgpt("gpt-5.3-codex-spark"),
      modelContextWindowTokens: 128_000,
      modelOptions: {
        providerOptions: { openai: { reasoningSummary: null } },
      },
    };

  const key = yield* Config.schema(
    Schema.RedactedFromValue(Schema.NonEmptyString.check(Schema.isTrimmed())),
    "OPENROUTER_API_KEY"
  );

  const openrouter = createOpenRouter({
    apiKey: Redacted.value(key),
    compatibility: "strict",
    extraBody: {
      provider: {
        allow_fallbacks: false,
        max_price: { prompt: 0, completion: 0, request: 0 },
      },
    },
  });

  return {
    model: openrouter("nvidia/nemotron-3.5-lightning:free"),
    modelContextWindowTokens: 1_000_000,
  };
});
