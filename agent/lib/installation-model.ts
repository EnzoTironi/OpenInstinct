import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Config, Effect, Redacted, Schema } from "effect";
import { chatgpt } from "eve/models/openai";
import type { AgentModelOptionsDefinition } from "eve";
import { withModelDeadline } from "./model-deadline";
import {
  browserModelProviderSchema,
  codexModelSchema,
  installationModelProviderSchema,
} from "@shared/environment/model-provider";

const openRouterKey = Config.schema(
  Schema.Redacted(Schema.NonEmptyString.check(Schema.isTrimmed())),
  "OPENROUTER_API_KEY"
);

function codexSelection(model: typeof codexModelSchema.Type) {
  const modelOptions: AgentModelOptionsDefinition = {
    providerOptions: { openai: { reasoningSummary: null } },
  };
  return {
    model: withModelDeadline(chatgpt(model)),
    modelContextWindowTokens:
      model === "gpt-5.3-codex-spark" ? 128_000 : 272_000,
    modelOptions,
  };
}

export const installationModel = Effect.gen(function* () {
  const provider = yield* Config.schema(
    installationModelProviderSchema,
    "COMPANION_MODEL_PROVIDER"
  ).pipe(Config.withDefault("gateway"));
  if (provider === "gateway") return null;
  if (provider === "codex-local") {
    const model = yield* Config.schema(
      codexModelSchema,
      "COMPANION_CODEX_MODEL"
    ).pipe(Config.withDefault("gpt-5.3-codex-spark"));
    return codexSelection(model);
  }

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
    model: withModelDeadline(openrouter("nvidia/nemotron-3.5-lightning:free")),
    modelContextWindowTokens: 1_000_000,
  };
});

export const browserInstallationModel = Effect.gen(function* () {
  const provider = yield* Config.schema(
    browserModelProviderSchema,
    "COMPANION_BROWSER_MODEL_PROVIDER"
  ).pipe(Config.withDefault("gateway"));
  const model = yield* Config.schema(
    provider === "codex-local"
      ? codexModelSchema
      : Schema.Literals(["meta/muse-spark-1.3", "openai/gpt-5-mini"]),
    "COMPANION_BROWSER_MODEL"
  ).pipe(
    Config.withDefault(
      provider === "codex-local" ? "gpt-5.3-codex-spark" : "meta/muse-spark-1.3"
    )
  );
  if (provider === "codex-local")
    return codexSelection(
      yield* Schema.decodeUnknownEffect(codexModelSchema)(model)
    );
  if (provider === "gateway") return model;

  const key = yield* openRouterKey;
  const openrouter = createOpenRouter({
    apiKey: Redacted.value(key),
    compatibility: "strict",
    extraBody: { provider: { allow_fallbacks: false } },
  });
  const modelOptions: AgentModelOptionsDefinition = {
    providerOptions: { openrouter: { max_tokens: 4_096 } },
  };
  return {
    model: withModelDeadline(openrouter(model)),
    modelContextWindowTokens:
      model === "meta/muse-spark-1.3" ? 1_048_576 : 400_000,
    modelOptions,
  };
});
