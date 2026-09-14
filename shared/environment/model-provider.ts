import { Schema } from "effect";

export const installationModelProviderSchema = Schema.Literals([
  "gateway",
  "openrouter-free",
  "codex-local",
]);

export const browserModelProviderSchema = Schema.Literals([
  "gateway",
  "openrouter",
  "codex-local",
]);

export const codexModelSchema = Schema.Literals([
  "gpt-5.3-codex-spark",
  "gpt-5.6-luna",
]);

export const browserModelSchema = Schema.Literals([
  "meta/muse-spark-1.3",
  "openai/gpt-5-mini",
  ...codexModelSchema.literals,
]);
