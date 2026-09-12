import { describe, expect, it } from "vitest";
import { channelPrincipal } from "./principal";

const identity = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  channel: "telegram" as const,
  installationId: "123456",
  senderId: "789012",
};

describe("channelPrincipal group attributes", () => {
  it("keeps private conversationId on the identity", () => {
    const principal = channelPrincipal(identity, "55");
    expect(principal.attributes).toMatchObject({
      conversationId: identity.id,
      sourceMessageId: "55",
    });
    expect(principal.attributes).not.toHaveProperty("groupChatId");
  });

  it("switches conversationId to the group scope and exposes groupChatId", () => {
    const principal = channelPrincipal(identity, "88", {
      conversationScope: "group:telegram:123456:-100123",
      chatKind: "group",
      chatId: "-100123",
    });
    expect(principal.attributes).toMatchObject({
      conversationId: "group:telegram:123456:-100123",
      groupChatId: "-100123",
      chatKind: "group",
      sourceMessageId: "88",
    });
  });
});
