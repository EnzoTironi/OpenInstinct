import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { readChat } from "@db/services/chats";
import type { isSessionOwned } from "@db/services/sessions";
import type { requireRequestScope } from "@web/auth/request-scope";
import { accessScopeForUser } from "@shared/identity/access-scope";

const mocks = vi.hoisted(() => ({
  isSessionOwned: vi.fn<typeof isSessionOwned>(),
  notFound: vi.fn<() => never>(() => {
    throw new Error("not-found");
  }),
  readChat: vi.fn<typeof readChat>(),
  requireRequestScope: vi.fn<typeof requireRequestScope>(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));
vi.mock("@db/services/chats", () => ({
  readChat: mocks.readChat,
}));
vi.mock("@db/services/sessions", () => ({
  isSessionOwned: mocks.isSessionOwned,
}));
vi.mock("@web/auth/request-scope", () => ({
  requireRequestScope: mocks.requireRequestScope,
}));
vi.mock("./_components/chat-session", () => ({
  ChatSession: ({ sessionId }: { readonly sessionId: string }) =>
    createElement("div", null, sessionId),
}));

import ChatSessionPage from "./page";

const scope = accessScopeForUser("alice");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRequestScope.mockResolvedValue(scope);
  mocks.readChat.mockResolvedValue(undefined);
});

describe("chat session page", () => {
  it("does not open a session the caller does not own", async () => {
    mocks.isSessionOwned.mockResolvedValue(false);
    mocks.readChat.mockResolvedValue({
      channel: "http",
      createdAt: "2026-09-15T00:00:00.000Z",
      sessionId: "session-alice",
      title: "Secret",
      updatedAt: "2026-09-15T00:00:00.000Z",
      usage: { costUsd: null, inputTokens: 1, outputTokens: 0 },
    });

    await expect(
      ChatSessionPage({
        params: Promise.resolve({ sessionId: "session-alice" }),
      })
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.isSessionOwned).toHaveBeenCalledWith(scope, "session-alice");
    expect(mocks.readChat).not.toHaveBeenCalled();
  });

  it("opens an owned session before the chat row exists", async () => {
    mocks.isSessionOwned.mockResolvedValue(true);

    const page = await ChatSessionPage({
      params: Promise.resolve({ sessionId: "session-new" }),
    });

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.readChat).toHaveBeenCalledWith(scope, "session-new");
    expect(page).toBeTruthy();
  });
});
