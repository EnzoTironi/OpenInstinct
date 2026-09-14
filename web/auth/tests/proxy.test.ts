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

  it.each([
    "/fonts/vault-variable.woff2",
    "/marketing/stars.webp",
    "/marketing/whatsapp.avif",
  ])("does not match public asset %s", (url) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url,
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

  it("leaves native approval callback authentication to its signed Eve endpoint", async () => {
    const response = await proxy(
      new NextRequest("https://example.com/internal/channel-input/respond", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it.each([
    "/internal/channel-input/other",
    "/internal/channel-input/respond/other",
  ])("does not open unrelated internal path %s", async (path) => {
    const response = await proxy(new NextRequest(`https://example.com${path}`));
    expect(response.status).toBe(307);
    expect(getAuthSession).toHaveBeenCalledOnce();
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
