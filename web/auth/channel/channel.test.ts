import { createElement } from "react";
import { renderToEnglishMarkup as renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import {
  channelHttpError,
  channelFailureMessage,
  reauthenticationDestination,
} from "./client";
import { ChannelAuthForm } from "./form";
import { ChannelStatus } from "./status";

const challenge = {
  id: "5dd20c8c-9d99-49ea-8e04-936d238dac03",
  channel: "telegram" as const,
  deepLink: "https://t.me/assistant_bot?start=example",
  expiresAt: "2026-09-08T12:00:00.000Z",
};

describe("shared channel authorization", () => {
  it.each([
    {
      channel: "telegram" as const,
      deepLink: "https://t.me/assistant_bot?start=proof_with-characters",
      appHref:
        "tg://resolve?domain=assistant_bot&amp;start=proof_with-characters",
    },
    {
      channel: "kapso" as const,
      deepLink:
        "https://wa.me/553798136141?text=%2Fstart+proof_with-characters",
      appHref:
        "whatsapp://send?phone=553798136141&amp;text=%2Fstart+proof_with-characters",
    },
  ])(
    "opens $channel in its app while retaining the browser challenge",
    ({ channel, deepLink, appHref }) => {
      const html = renderToStaticMarkup(
        createElement(ChannelStatus, {
          challenge: { ...challenge, channel, deepLink },
          purpose: "link",
          status: "pending",
          busy: false,
          error: undefined,
          onContinue: () => undefined,
          onRestart: () => undefined,
        })
      );
      const appLink = /<a\b[^>]*href="(?:tg|whatsapp):[^>]*>/u.exec(html)?.[0];
      expect(appLink).toContain(`href="${appHref}"`);
      expect(appLink).not.toContain("target=");
      expect(html).toContain("Use the web version");
      expect(html).toContain(`href="${deepLink}"`);
    }
  );
  it("offers explicit linking actions without starting a challenge during render", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelAuthForm, {
        purpose: "link",
        callbackUrl: "/account",
      })
    );
    expect(html).toContain("Link Telegram");
    expect(html).toContain("Link WhatsApp");
    expect(html).toContain("Confirm the link in that chat");
    expect(html).not.toContain("Continue with Telegram");
    expect(html).not.toContain("t.me");
  });
  it("preserves ordinary sign-in wording", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelAuthForm, { purpose: "login", callbackUrl: "/" })
    );
    expect(html).toContain("Continue with Telegram");
    expect(html).toContain("Continue with WhatsApp");
    expect(html).not.toContain("Link Telegram");
  });
  it.each([
    {
      status: "pending" as const,
      present: "Only approve it if you started it here",
      absent: "Finish linking account",
    },
    {
      status: "confirmed" as const,
      present: "Finish linking account",
      absent: "t.me",
    },
  ])(
    "describes the current-account linking action at $status",
    ({ status, present, absent }) => {
      const html = renderToStaticMarkup(
        createElement(ChannelStatus, {
          challenge,
          purpose: "link",
          status,
          busy: false,
          error: undefined,
          onContinue: () => undefined,
          onRestart: () => undefined,
        })
      );
      expect(html).toContain("current Zoen account");
      expect(html).not.toContain("Enter this browser");
      expect(html).toContain(present);
      expect(html).not.toContain(absent);
    }
  );
  it.each(["pending", "confirmed"] as const)(
    "describes native link %s without promising an account merge",
    (status) => {
      const html = renderToStaticMarkup(
        createElement(ChannelStatus, {
          challenge: {
            id: challenge.id,
            channel: "kapso",
            purpose: "link",
            expiresAt: challenge.expiresAt,
          },
          purpose: "link",
          status,
          busy: false,
          error: undefined,
          onContinue: () => undefined,
          onRestart: () => undefined,
        })
      );
      expect(html).toContain("existing association");
      expect(html).toContain("Accounts and their data are not combined");
      expect(html).not.toContain("Enter this browser");
      expect(html).not.toContain("wa.me");
    }
  );
  it("explains session freshness and account conflicts without changing login errors", () => {
    expect(channelFailureMessage(channelHttpError(401), "link")).toContain(
      "Sign in again"
    );
    expect(channelFailureMessage(channelHttpError(409), "link")).toContain(
      "outra conta Zoen"
    );
    const original = channelHttpError(403);
    expect(channelFailureMessage(original, "login")).toBe(original.message);
    expect(channelFailureMessage(original, "link")).toContain(
      "account-linking request"
    );
  });
});

describe("reauthentication redirect policy", () => {
  it("does not redirect a rejected logout", () => {
    expect(
      reauthenticationDestination(
        { status: "rejected", reason: new Error("connection lost") },
        "/account"
      )
    ).toBeUndefined();
  });
  it("does not redirect a fulfilled logout containing an error", () => {
    expect(
      reauthenticationDestination(
        {
          status: "fulfilled",
          value: {
            data: null,
            error: { status: 503, statusText: "Service Unavailable" },
          },
        },
        "/account"
      )
    ).toBeUndefined();
  });
  it("requires an affirmative logout result", () => {
    expect(
      reauthenticationDestination(
        {
          status: "fulfilled",
          value: { data: { success: false }, error: null },
        },
        "/account"
      )
    ).toBeUndefined();
  });
  it("allows reauthentication after confirmed logout and sanitizes the callback", () => {
    const outcome = {
      status: "fulfilled" as const,
      value: { data: { success: true }, error: null },
    };
    expect(reauthenticationDestination(outcome, "/account")).toBe(
      "/sign-in?callbackUrl=%2Faccount"
    );
    expect(
      reauthenticationDestination(outcome, "https://attacker.invalid")
    ).toBe("/sign-in?callbackUrl=%2F");
  });
});
