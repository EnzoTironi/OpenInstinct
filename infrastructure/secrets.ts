import { createHash } from "node:crypto";
import { adopt } from "alchemy/AdoptPolicy";
import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Config, Effect } from "effect";

export const webSecretNames = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "COMPANION_MODEL_PROVIDER",
  "COMPANION_PUBLIC_BASE_URL",
  "WORKFLOW_LOCAL_BASE_URL",
  "TELEGRAM_BOT_ID",
  "TELEGRAM_BOT_USERNAME",
  "ZOEN_MEM0_URL",
  "MARKETING_IMESSAGE_NUMBER",
  "MARKETING_TELEGRAM_USERNAME",
  "MARKETING_WHATSAPP_NUMBER",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "SECRET_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "KAPSO_API_KEY",
  "KAPSO_PHONE_NUMBER_ID",
  "KAPSO_WEBHOOK_SECRET",
  "KERNEL_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "CHATGPT_AUTH_JSON",
  "CODEX_AUTH_JSON",
  "ZOEN_MEM0_API_KEY",
] as const;

/** Only vault digests enter Machine metadata; rotations restart the consumer with the new vault values. */
export const appSecrets = Effect.fn(function* (
  id: string,
  app: Fly.App,
  names: readonly string[]
) {
  const entries = yield* Effect.forEach(names, (name) =>
    Effect.gen(function* () {
      const value = yield* Config.redacted(name);
      return yield* Fly.Secret(`${id}${name}`, { app, name, value }).pipe(
        adopt(true),
        RemovalPolicy.retain(true)
      );
    })
  );
  return Output.all(...entries.map((entry) => entry.digest)).pipe(
    Output.map((digests) =>
      createHash("sha256").update(JSON.stringify(digests)).digest("hex")
    )
  );
});
