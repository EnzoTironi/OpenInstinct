import { Config, ConfigProvider, Effect, Predicate, Schema } from "effect";
import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserInstallationModel,
  installationModel,
} from "../installation-model";

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
      modelContextWindowTokens: 128_000,
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

const selectBrowserModel = (
  configuration: Record<string, string | undefined>
) =>
  Effect.runPromise(
    browserInstallationModel.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(configuration)
      )
    )
  );

describe("browser model configuration", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserves the default Gateway browser independently of the root model", async () => {
    expect(await selectBrowserModel({})).toBe("meta/muse-spark-1.3");
    expect(
      await selectBrowserModel({ COMPANION_MODEL_PROVIDER: "codex-local" })
    ).toBe("meta/muse-spark-1.3");
  });

  it("routes the existing vision model directly through OpenRouter when selected", async () => {
    const selected = await selectBrowserModel({
      COMPANION_MODEL_PROVIDER: "codex-local",
      COMPANION_BROWSER_MODEL_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "synthetic-constructor-only-key",
      AI_GATEWAY_API_KEY: "rejected-gateway-key-must-not-be-used",
    });
    expect(selected).toMatchObject({
      model: {
        modelId: "meta/muse-spark-1.3",
        provider: "openrouter",
        specificationVersion: "v4",
      },
      modelContextWindowTokens: 1_048_576,
    });
    expect(
      await selectModel({
        COMPANION_MODEL_PROVIDER: "codex-local",
        COMPANION_BROWSER_MODEL_PROVIDER: "openrouter",
      })
    ).toMatchObject({ model: { modelId: "gpt-5.3-codex-spark" } });
  });

  it("fails closed on missing or invalid credentials without switching providers", async () => {
    await Promise.all(
      [undefined, "", " ", " padded-key "].map((key) => {
        const configuration = {
          COMPANION_BROWSER_MODEL_PROVIDER: "openrouter",
          AI_GATEWAY_API_KEY: "must-not-fall-back",
          OPENROUTER_API_KEY: key,
        };
        return expect(selectBrowserModel(configuration)).rejects.toBeInstanceOf(
          Config.ConfigError
        );
      })
    );
  });

  it("uses the explicitly selected hosted vision model and its own context limit", async () => {
    expect(
      await selectBrowserModel({
        COMPANION_BROWSER_MODEL_PROVIDER: "openrouter",
        COMPANION_BROWSER_MODEL: "openai/gpt-5-mini",
        OPENROUTER_API_KEY: "synthetic-constructor-only-key",
      })
    ).toMatchObject({
      model: { modelId: "openai/gpt-5-mini", provider: "openrouter" },
      modelContextWindowTokens: 400_000,
    });
    await expect(
      selectBrowserModel({ COMPANION_BROWSER_MODEL: "text-only-unknown" })
    ).rejects.toBeInstanceOf(Config.ConfigError);
  });

  it.each([
    ["gpt-5.3-codex-spark", 128_000],
    ["gpt-5.6-luna", 272_000],
  ] as const)(
    "uses %s without hosted provider credentials",
    async (model, window) => {
      expect(
        await selectBrowserModel({
          COMPANION_BROWSER_MODEL_PROVIDER: "codex-local",
          COMPANION_BROWSER_MODEL: model,
        })
      ).toMatchObject({
        model: { modelId: model },
        modelContextWindowTokens: window,
      });
      expect(
        await selectModel({
          COMPANION_MODEL_PROVIDER: "codex-local",
          COMPANION_CODEX_MODEL: model,
        })
      ).toMatchObject({
        model: { modelId: model },
        modelContextWindowTokens: window,
      });
    }
  );

  it("rejects provider/model mismatches instead of silently changing the provider", async () => {
    await expect(
      selectBrowserModel({
        COMPANION_BROWSER_MODEL_PROVIDER: "codex-local",
        COMPANION_BROWSER_MODEL: "openai/gpt-5-mini",
      })
    ).rejects.toBeInstanceOf(Config.ConfigError);
    await expect(
      selectBrowserModel({
        COMPANION_BROWSER_MODEL_PROVIDER: "openrouter",
        COMPANION_BROWSER_MODEL: "gpt-5.3-codex-spark",
      })
    ).rejects.toBeInstanceOf(Config.ConfigError);
  });

  it("rejects an unsupported browser provider", async () => {
    await expect(
      selectBrowserModel({ COMPANION_BROWSER_MODEL_PROVIDER: "unknown" })
    ).rejects.toBeInstanceOf(Config.ConfigError);
  });

  it("caps the actual provider request instead of reserving the framework's entire output allowance", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = Schema.decodeUnknownSync(
          Schema.fromJsonString(
            Schema.Struct({
              model: Schema.String,
              max_tokens: Schema.Number,
              provider: Schema.Struct({ allow_fallbacks: Schema.Boolean }),
            })
          )
        )(init?.body);
        expect(body.model).toBe("openai/gpt-5-mini");
        expect(body.max_tokens).toBe(4_096);
        expect(body.provider).toEqual({ allow_fallbacks: false });
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer synthetic-constructor-only-key"
        );
        return Response.json({
          id: "browser-proof",
          model: "openai/gpt-5-mini",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "OK" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      });
    vi.stubGlobal("fetch", request);
    const selected = await selectBrowserModel({
      COMPANION_BROWSER_MODEL_PROVIDER: "openrouter",
      COMPANION_BROWSER_MODEL: "openai/gpt-5-mini",
      OPENROUTER_API_KEY: "synthetic-constructor-only-key",
    });
    if (Predicate.isString(selected))
      throw new Error("Expected a direct model.");
    const result = await generateText({
      model: selected.model,
      providerOptions: Schema.decodeUnknownSync(
        Schema.Struct({
          openrouter: Schema.Struct({ max_tokens: Schema.Number }),
        })
      )(selected.modelOptions.providerOptions),
      maxOutputTokens: 65_536,
      prompt: "Reply OK.",
    });
    expect(result.text).toBe("OK");
    expect(request).toHaveBeenCalledOnce();
  });
});
