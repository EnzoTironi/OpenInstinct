import { Effect } from "effect";
import { expect, test } from "vitest";

import {
  bindGroupChannelIdentity,
  detectKapsoChatKind,
  detectTelegramChatKind,
  evaluateGroupMentionPolicy,
  extractKapsoGroupMentionSignals,
  telegramTextMentionsBot,
} from "./group-policy";

test("detects telegram private, group, and unsupported chat kinds", () => {
  expect(detectTelegramChatKind("private")).toBe("private");
  expect(detectTelegramChatKind("group")).toBe("group");
  expect(detectTelegramChatKind("supergroup")).toBe("group");
  expect(detectTelegramChatKind("channel")).toBe("unsupported");
});

test("detects kapso group flags without accepting them", () => {
  expect(detectKapsoChatKind({})).toBe("private");
  expect(detectKapsoChatKind({ type: "individual" })).toBe("private");
  expect(detectKapsoChatKind({ is_group: true })).toBe("group");
  expect(detectKapsoChatKind({ type: "group" })).toBe("group");
});

test("mention policy accepts only mention or reply-to-bot (no spam)", () => {
  expect(
    evaluateGroupMentionPolicy({ mentionedBot: false, replyToBot: false })
  ).toBe(false);
  expect(
    evaluateGroupMentionPolicy({ mentionedBot: true, replyToBot: false })
  ).toBe(true);
  expect(
    evaluateGroupMentionPolicy({ mentionedBot: false, replyToBot: true })
  ).toBe(true);
});

test("telegram mention helper matches @username and text_mention entities", () => {
  expect(
    telegramTextMentionsBot(
      "hey @CompanionBot help",
      "CompanionBot",
      undefined,
      "123"
    )
  ).toBe(true);
  expect(
    telegramTextMentionsBot("hey everyone", "CompanionBot", undefined, "123")
  ).toBe(false);
  expect(
    telegramTextMentionsBot(
      "ping",
      "CompanionBot",
      [{ type: "text_mention", offset: 0, length: 4, user: { id: 123 } }],
      "123"
    )
  ).toBe(true);
});

test("bindGroupChannelIdentity scopes conversation to group chat", async () => {
  const binding = await Effect.runPromise(
    bindGroupChannelIdentity({
      identityId: "11111111-1111-4111-8111-111111111111",
      channel: "telegram",
      installationId: "123456",
      senderId: "789012",
      chatId: "-100123",
    })
  );

  expect(binding).toEqual({
    identityId: "11111111-1111-4111-8111-111111111111",
    channel: "telegram",
    installationId: "123456",
    senderId: "789012",
    chatId: "-100123",
    chatKind: "group",
    conversationScope: "group:telegram:123456:-100123",
    deliveryTargetId: "-100123",
  });
});

test("kapso mention extract requires explicit provider signals", () => {
  expect(
    evaluateGroupMentionPolicy(
      extractKapsoGroupMentionSignals({
        installationPhoneDigits: "15550001111",
      })
    )
  ).toBe(false);
  expect(
    evaluateGroupMentionPolicy(
      extractKapsoGroupMentionSignals({
        installationPhoneDigits: "15550001111",
        kapso: { mentioned_business: true },
      })
    )
  ).toBe(true);
  expect(
    evaluateGroupMentionPolicy(
      extractKapsoGroupMentionSignals({
        installationPhoneDigits: "15550001111",
        mentions: ["+15550001111"],
      })
    )
  ).toBe(true);
  expect(
    evaluateGroupMentionPolicy(
      extractKapsoGroupMentionSignals({
        installationPhoneDigits: "15550001111",
        contextFromMe: true,
      })
    )
  ).toBe(true);
});
