import { describe, expect, it } from "vitest";
import { googleWorkspaceReturnTo } from "./connection";

describe("Google connection return destination", () => {
  it.each([
    "/chat/wrun_01M20W65G78HTMYSP8HKD2Y8VV",
    "/chat/session-123",
    "/chat/" + "a".repeat(256),
  ])("preserves the original concrete chat %s", (path) => {
    expect(googleWorkspaceReturnTo(path)).toBe(path);
    const callback = new URL(
      googleWorkspaceReturnTo(path),
      "https://companion.example"
    );
    callback.searchParams.set("google", "connected");
    expect(callback.origin).toBe("https://companion.example");
    expect(callback.pathname).toBe(path);
  });

  it.each([
    undefined,
    "",
    "/",
    "/chat",
    "/chat/",
    "/chat/history",
    "/chat/session-123/",
    "/chat/session-123/messages",
    "/chat/session-123?next=https://other.example",
    "/chat/session-123#result",
    "https://other.example/chat/session-123",
    "https://companion.example/chat/session-123",
    "//other.example/chat/session-123",
    "javascript:alert(1)",
    "/chat/..",
    "/chat/../vault",
    "/chat/%2e%2e",
    "/chat/%2F%2Fother.example",
    "/chat/%252Fother.example",
    "/chat/\\other",
    "/chat/session-123\n",
    "/chat/session-123\r\n",
    "/chat/session-123\u2028",
    "/chat/session-123\u0000",
    " /chat/session-123",
    "/chat/" + "a".repeat(257),
  ])("falls back to Workspace for %j", (value) => {
    expect(googleWorkspaceReturnTo(value)).toBe("/");
  });
});
