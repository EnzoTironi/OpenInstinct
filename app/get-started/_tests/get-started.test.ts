import { createElement } from "react";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { ConfigProvider, Effect } from "effect";
import type * as Destination from "../../../server/channels/destination";
import GetStartedPage from "../page";
import { GetStartedPanel } from "../_components/get-started-panel";

const channelConfig = vi.hoisted(() => ({
  KAPSO_PHONE_NUMBER_ID: "test-installation",
  KAPSO_PHONE_NUMBER: "+15551234567",
  TELEGRAM_BOT_ID: "test-bot-id",
  TELEGRAM_BOT_USERNAME: "companion_test_bot",
  LINQ_PHONE_NUMBER: "+15557654321",
}));

vi.mock("../../../server/channels/destination", async (importOriginal) => {
  const actual = await importOriginal<typeof Destination>();
  return {
    ...actual,
    conversationDestinations: actual.conversationDestinations.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(channelConfig)
      )
    ),
  };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn<typeof redirect>(() => {
    throw new Error("redirect");
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  channelConfig.KAPSO_PHONE_NUMBER_ID = "test-installation";
  channelConfig.KAPSO_PHONE_NUMBER = "+15551234567";
  channelConfig.TELEGRAM_BOT_USERNAME = "companion_test_bot";
  channelConfig.LINQ_PHONE_NUMBER = "+15557654321";
});

describe("conversation entry", () => {
  it("keeps public conversation destinations independent from channel authentication", async () => {
    const actual = await vi.importActual<typeof Destination>(
      "../../../server/channels/destination"
    );
    const result = await Effect.runPromise(
      Effect.all({
        conversations: actual.conversationDestinations,
        authorization: actual.channelDestination("telegram"),
      }).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            ...channelConfig,
            MARKETING_WHATSAPP_NUMBER: "+553798136141",
            MARKETING_TELEGRAM_USERNAME: "TryZoenBot",
            MARKETING_IMESSAGE_NUMBER: "+553798136141",
          })
        )
      )
    );
    expect(result.conversations).toEqual({
      whatsapp: "https://wa.me/553798136141?text=Oi%2C+Zoen%21",
      telegram: "https://t.me/TryZoenBot",
      imessage: "sms:+553798136141",
    });
    expect(result.authorization.url).toBe("https://t.me/companion_test_bot");
    expect(result.authorization.installationId).toBe("test-bot-id");
  });
  it("opens the configured WhatsApp without issuing browser authorization", async () => {
    channelConfig.KAPSO_PHONE_NUMBER_ID = "";
    await expect(
      GetStartedPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith(
      "https://wa.me/15551234567?text=Oi%2C+Zoen%21"
    );
  });
  it("honors the Telegram choice", async () => {
    await expect(
      GetStartedPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ channel: "telegram" }),
      })
    ).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("https://t.me/companion_test_bot");
  });
  it("opens Messages at the configured number without adding message content", async () => {
    await expect(
      GetStartedPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ channel: "imessage" }),
      })
    ).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("sms:+15557654321");
  });
  it("uses Telegram when the default channel is unavailable", async () => {
    channelConfig.KAPSO_PHONE_NUMBER = "";
    await expect(
      GetStartedPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("https://t.me/companion_test_bot");
  });
  it("never treats a query parameter as a redirect destination", async () => {
    const page = await GetStartedPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({
        channel: "https://example.com",
        callbackUrl: "https://example.com",
      }),
    });
    expect(redirect).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Abrir WhatsApp");
    expect(html).not.toContain("example.com");
  });
  it("shows an honest unavailable state for missing or malformed destinations", async () => {
    channelConfig.KAPSO_PHONE_NUMBER = "+15551234567/evil";
    channelConfig.TELEGRAM_BOT_USERNAME = "";
    channelConfig.LINQ_PHONE_NUMBER = "+15557654321?body=evil";
    const page = await GetStartedPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    });
    expect(redirect).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(page);
    expect(html).toContain("A conversa ainda não está disponível");
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("t.me/");
    expect(html).not.toContain("sms:");
  });
  it("offers direct conversation links without a signup form or pricing page", () => {
    const html = renderToStaticMarkup(
      createElement(GetStartedPanel, {
        whatsappUrl: "https://wa.me/15551234567",
        telegramUrl: null,
        imessageUrl: null,
      })
    );
    expect(html).toContain('href="https://wa.me/15551234567"');
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("/pricing");
  });
});
