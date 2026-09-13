import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Config, Effect, Redacted, Schema } from "effect";
import { chatgpt } from "eve/models/openai";
import {
  browserModelProviderSchema,
  browserModelSchema,
  installationModelProviderSchema,
} from "@shared/environment/model-provider";

const openRouterKey = Config.schema(
  Schema.Redacted(Schema.NonEmptyString.check(Schema.isTrimmed())),
  "OPENROUTER_API_KEY"
);

export const installationModel = Effect.gen(function* () {
  const provider = yield* Config.schema(
    installationModelProviderSchema,
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

  const key = yield* openRouterKey;
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

export const browserInstallationModel = Effect.gen(function* () {
  const provider = yield* Config.schema(
    browserModelProviderSchema,
    "COMPANION_BROWSER_MODEL_PROVIDER"
  ).pipe(Config.withDefault("gateway"));
  const model = yield* Config.schema(
    browserModelSchema,
    "COMPANION_BROWSER_MODEL"
  ).pipe(Config.withDefault("meta/muse-spark-1.3"));
  if (provider === "gateway") return model;

  const key = yield* openRouterKey;
  const openrouter = createOpenRouter({
    apiKey: Redacted.value(key),
    compatibility: "strict",
    extraBody: { provider: { allow_fallbacks: false } },
  });
  return {
    model: openrouter(model),
    modelContextWindowTokens:
      model === "meta/muse-spark-1.3" ? 1_048_576 : 400_000,
    modelOptions: { providerOptions: { openrouter: { max_tokens: 4_096 } } },
  };
});
