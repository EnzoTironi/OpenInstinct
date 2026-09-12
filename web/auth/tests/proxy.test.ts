import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthSession } from "@db/services/auth/session";
import { config, proxy } from "../../../proxy";

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn<typeof getAuthSession>(),
}));

vi.mock("@db/services/auth/session", () => ({
  getAuthSession: mocks.getAuthSession,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthSession.mockResolvedValue(null);
});

describe("auth proxy matcher", () => {
  it("does not match the generated document icon", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/icon",
      })
    ).toBe(false);
  });

  it("does not match public fonts", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/fonts/vault-variable.woff2",
      })
    ).toBe(false);
  });

  it("continues to match protected application routes", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/vault",
      })
    ).toBe(true);
  });

  it("leaves scheduled-run authorization to the Eve channel", async () => {
    const response = await proxy(
      new NextRequest("https://example.com/internal/scheduled-run/start")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows consumer get-started without a browser session", async () => {
    const response = await proxy(
      new NextRequest("https://example.com/get-started")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows marketing welcome, pricing, and docs without a browser session", async () => {
    const responses = await Promise.all(
      (["/welcome", "/pricing", "/docs"] as const).map((path) =>
        proxy(new NextRequest(`https://example.com${path}`))
      )
    );
    for (const response of responses) {
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("sends unauthenticated home visitors to the marketing landing", async () => {
    const response = await proxy(new NextRequest("https://example.com/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/welcome"
    );
  });

  it("allows the document icon and favicon without a browser session", async () => {
    const responses = await Promise.all(
      (["/icon", "/favicon.ico"] as const).map((path) =>
        proxy(new NextRequest(`https://example.com${path}`))
      )
    );
    for (const response of responses) {
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows the schedule dispatcher without a browser session in development", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/eve/v1/dev/schedules/dynamic")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });
});
