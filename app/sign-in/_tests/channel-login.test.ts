import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ChannelStatus } from "@web/auth/channel/status";
import {
  channelHttpError,
  checkChannelAuthorization,
  channelPollFailure,
  invalidChannelChallenge,
  safeCallbackUrl,
} from "@web/auth/channel/client";
import { channelChallengeSchema } from "@shared/identity/channel-auth";

const challenge = Schema.decodeUnknownSync(channelChallengeSchema)({
  id: "5dd20c8c-9d99-49ea-8e04-936d238dac03",
  channel: "telegram",
  deepLink: "https://t.me/assistant_bot?start=example",
  expiresAt: "2026-09-08T12:00:00.000Z",
});

it.each([
  { headers: new Headers({ "X-Retry-After": "12" }), expected: "12" },
  {
    headers: new Headers({ "Retry-After": "20", "X-Retry-After": "12" }),
    expected: "20",
  },
])(
  "reads the authentication server's retry headers: $expected seconds",
  async ({ headers, expected }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429, headers }))
    );
    try {
      await expect(
        Effect.runPromise(checkChannelAuthorization(challenge.id))
      ).rejects.toMatchObject({
        status: 429,
        category: "rate-limit",
        retryAfter: expected,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  }
);

function renderStatus(
  status: "pending" | "confirmed" | "expired" | "consumed" | "invalid",
  busy = false
) {
  return renderToStaticMarkup(
    createElement(ChannelStatus, {
      challenge,
      purpose: "login",
      status,
      busy,
      error: undefined,
      onContinue: () => undefined,
      onRestart: () => undefined,
    })
  );
}

describe("sign-in navigation", () => {
  it.each([
    undefined,
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5cevil.example",
    "/%2fevil.example",
    "javascript:alert(1)",
    "/\nevil.example",
    "/%00evil",
    " /chat",
    "/%zz",
  ])("rejects unsafe callback %j", (value) => {
    expect(safeCallbackUrl(value)).toBe("/");
  });
  it.each(["/chat", "/tasks/123?view=details#result", "/?from=sign-in"])(
    "preserves local callback %s",
    (value) => {
      expect(safeCallbackUrl(value)).toBe(value);
    }
  );
});

describe("browser-bound sign-in states", () => {
  it("asks for exact browser confirmation and offers a user-opened messenger link while pending", () => {
    const html = renderStatus("pending");
    expect(html).toContain("confirm the request to sign in to this browser");
    expect(html).toContain('href="https://t.me/assistant_bot?start=example"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("expires at");
    expect(html).not.toContain("Enter this browser");
  });
  it("requires explicit browser continuation after chat confirmation", () => {
    const html = renderStatus("confirmed");
    expect(html).toContain("Enter this browser");
    expect(html).not.toContain('href="https://t.me');
    expect(renderStatus("confirmed", true)).toContain("disabled");
  });
  it.each(["expired", "consumed", "invalid"] as const)(
    "only offers restart for %s challenges",
    (status) => {
      const html = renderStatus(status);
      expect(html).toContain("Start again");
      expect(html).not.toContain("Enter this browser");
      expect(html).not.toContain('href="https://t.me');
    }
  );
  it("provides actionable unavailable and lost-browser errors", () => {
    expect(channelHttpError(503).message).toContain("other messenger");
    expect(channelHttpError(403).message).toContain("Start again");
    expect(channelHttpError(429).message).toContain("Wait");
  });
});

describe("poll failure transitions", () => {
  const now = Date.parse("2026-09-08T11:00:00Z");
  const expiry = now + 120_000;

  it.each([400, 401, 403, 404, 409, 410])(
    "invalidates HTTP %s without another poll or messenger link",
    (status) => {
      const failure = channelHttpError(status);
      expect(failure.status).toBe(status);
      expect(failure.category).toBe("terminal");
      const next = channelPollFailure(failure, 0, now, expiry);
      expect(next).toEqual({ status: "invalid", failures: 0, delay: 0 });
      expect(renderStatus(next.status)).not.toContain("href=");
    }
  );

  it("invalidates malformed challenge data while retaining the actual response status", () => {
    const failure = invalidChannelChallenge(200);
    expect(failure.status).toBe(200);
    expect(channelPollFailure(failure, 0, now, expiry).status).toBe("invalid");
  });

  it.each(["45", "Tue, 08 Sep 2026 11:00:45 GMT"])(
    "honors Retry-After %s on rate limiting",
    (header) => {
      const failure = channelHttpError(429, header);
      expect(failure.retryAfter).toBe(header);
      expect(failure.category).toBe("rate-limit");
      expect(channelPollFailure(failure, 0, now, expiry)).toEqual({
        status: "pending",
        failures: 0,
        delay: 45_000,
      });
    }
  );

  it.each([null, "invalid", "-1", "1.5"])(
    "backs off rate limits with absent or invalid Retry-After %s",
    (header) => {
      expect(
        channelPollFailure(channelHttpError(429, header), 0, now, expiry).delay
      ).toBe(30_000);
    }
  );

  it("bounds exponential transient retries and then invalidates the request", () => {
    const failure = channelHttpError(503);
    let failures = 0;
    for (const delay of [4000, 8000, 16_000, 30_000]) {
      const next = channelPollFailure(failure, failures, now, expiry);
      expect(next.status).toBe("pending");
      expect(next.delay).toBe(delay);
      failures = next.failures;
    }
    expect(channelPollFailure(failure, failures, now, expiry)).toEqual({
      status: "invalid",
      failures: 5,
      delay: 0,
    });
  });

  it("never schedules another request beyond challenge expiry", () => {
    const failure = channelHttpError(429, "3600");
    expect(channelPollFailure(failure, 0, now, expiry).delay).toBe(
      expiry - now
    );
    expect(channelPollFailure(failure, 0, expiry, expiry)).toEqual({
      status: "expired",
      failures: 0,
      delay: 0,
    });
  });

  it("applies Retry-After to transient server failures too", () => {
    expect(
      channelPollFailure(channelHttpError(503, "60"), 0, now, expiry).delay
    ).toBe(60_000);
  });
});
