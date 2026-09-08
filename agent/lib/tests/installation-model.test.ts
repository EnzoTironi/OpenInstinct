import { Config, ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { installationModel } from "../installation-model";

const selectModel = (configuration: Record<string, string>) =>
  Effect.runPromise(
    installationModel.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(configuration)
      )
    )
  );

describe("installation model configuration", () => {
  it("defaults to gateway without requiring an OpenRouter key", async () => {
    expect(await selectModel({})).toBeNull();
    expect(
      await selectModel({ COMPANION_MODEL_PROVIDER: "gateway" })
    ).toBeNull();
    expect(await selectModel({ COMPANION_MODEL_PROVIDER: "" })).toBeNull();
  });

  it("constructs the actual free OpenRouter model with its context window", async () => {
    const selected = await selectModel({
      COMPANION_MODEL_PROVIDER: "openrouter-free",
      OPENROUTER_API_KEY: "synthetic-constructor-only-key",
    });
    expect(selected).toMatchObject({
      model: {
        modelId: "nvidia/nemotron-3.5-lightning:free",
        provider: "openrouter",
        specificationVersion: "v4",
      },
      modelContextWindowTokens: 1_000_000,
    });
  });

  it("constructs the native Codex model without an OpenRouter key", async () => {
    const selected = await selectModel({
      COMPANION_MODEL_PROVIDER: "codex-local",
    });
    expect(selected).toMatchObject({
      model: { modelId: "gpt-5.3-codex-spark", specificationVersion: "v4" },
      modelOptions: {
        providerOptions: { openai: { reasoningSummary: null } },
      },
    });
  });

  it("rejects missing, empty, whitespace-only and padded OpenRouter keys", async () => {
    const configuration = { COMPANION_MODEL_PROVIDER: "openrouter-free" };
    await expect(selectModel(configuration)).rejects.toBeInstanceOf(
      Config.ConfigError
    );
    await Promise.all(
      ["", " ", "\t\n", " padded-key "].map((key) =>
        expect(
          selectModel({ ...configuration, OPENROUTER_API_KEY: key })
        ).rejects.toBeInstanceOf(Config.ConfigError)
      )
    );
  });

  it("rejects invalid providers instead of falling back to gateway", async () => {
    await Promise.all(
      ["openrouter", "OPENROUTER-FREE", "gateway "].map((provider) =>
        expect(
          selectModel({
            COMPANION_MODEL_PROVIDER: provider,
            OPENROUTER_API_KEY: "synthetic-constructor-only-key",
          })
        ).rejects.toBeInstanceOf(Config.ConfigError)
      )
    );
  });
});
