import { Schema } from "effect";

export const installationModelProviderSchema = Schema.Literals([
  "gateway",
  "openrouter-free",
  "codex-local",
]);

export const browserModelProviderSchema = Schema.Literals([
  "gateway",
  "openrouter",
]);

export const browserModelSchema = Schema.Literals([
  "meta/muse-spark-1.3",
  "openai/gpt-5-mini",
]);
