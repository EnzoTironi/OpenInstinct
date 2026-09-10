import { Effect } from "effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  runTelegramGroupMentionHarness,
  type TelegramGroupHarnessResult,
} from "./groups-e2e-harness";
import { parseKapsoWebhook } from "./kapso";
import { bindGroupChannelIdentity } from "./group-policy";
import telegramGroupMentionFixture from "./fixtures/telegram-group-mention.redacted.json";
import kapsoGroupMentionFixture from "./fixtures/kapso-group-mention.redacted.json";

const ARTIFACT_DIR = "/tmp/companion-groups-live-e2e";
const installation = { botId: "123456", botUsername: "CompanionBot" };
const identityId = "11111111-1111-4111-8111-111111111111";
const nowMs = 1_788_895_784_000;

test("telegram group mention fixture → accept → bind (artifact)", async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  // Fixture date must be within validateEventAge window relative to nowMs.
  const update = {
    ...telegramGroupMentionFixture,
    message: {
      ...telegramGroupMentionFixture.message,
      date: Math.floor(nowMs / 1000),
    },
  };
  const result: TelegramGroupHarnessResult = await Effect.runPromise(
    runTelegramGroupMentionHarness({
      update,
      installation,
      nowMs,
      identityId,
    })
  );
  expect(result.accepted).toBe(true);
  expect(result.reason).toBe("accepted_and_bound");
  expect(result.events[0]).toMatchObject({
    kind: "message",
    chatKind: "group",
    chatId: "-1001234567890",
    senderId: "789012",
  });
  expect(result.binding).toEqual({
    identityId,
    channel: "telegram",
    installationId: "123456",
    senderId: "789012",
    chatId: "-1001234567890",
    chatKind: "group",
    conversationScope: "group:telegram:123456:-1001234567890",
    deliveryTargetId: "-1001234567890",
  });
  writeFileSync(
    `${ARTIFACT_DIR}/10-fixture-telegram-mention-bind.json`,
    JSON.stringify(
      {
        surface: "telegram-group-mention-fixture",
        accepted: result.accepted,
        reason: result.reason,
        event: {
          kind: result.events[0]?.kind,
          chatKind: result.events[0]?.chatKind,
          chatId: result.events[0]?.chatId,
          senderId: result.events[0]?.senderId,
        },
        binding: result.binding,
      },
      null,
      2
    )
  );
});

test("telegram bare group chatter stays dropped", async () => {
  const update = {
    update_id: 900002,
    message: {
      message_id: 43,
      date: Math.floor(nowMs / 1000),
      from: { id: 789012, is_bot: false },
      chat: { id: -1001234567890, type: "supergroup" },
      text: "casual chatter without a mention",
    },
  };
  const result: TelegramGroupHarnessResult = await Effect.runPromise(
    runTelegramGroupMentionHarness({
      update,
      installation,
      nowMs,
      identityId,
    })
  );
  expect(result.accepted).toBe(false);
  expect(result.events).toEqual([]);
});

test("kapso group opens only when mention signals exist; else stays closed", async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const mentioned = {
    ...kapsoGroupMentionFixture,
    message: {
      ...kapsoGroupMentionFixture.message,
      timestamp: String(Math.floor(nowMs / 1000)),
    },
  };
  const kapsoInstallation = {
    phoneNumberId: "123456789",
    phoneNumber: "15550001111",
  };
  const opened = await Effect.runPromise(
    parseKapsoWebhook(mentioned, kapsoInstallation, nowMs)
  );
  expect(opened).toHaveLength(1);
  const openedEvent = opened[0];
  expect(openedEvent).toMatchObject({
    kind: "message",
    chatKind: "group",
    chatId: "group-id-redacted",
    senderId: "15550002222",
  });
  if (openedEvent?.kind !== "message" || openedEvent.chatId === undefined) {
    throw new Error("expected opened kapso group message with chatId");
  }
  const binding = await Effect.runPromise(
    bindGroupChannelIdentity({
      identityId,
      channel: "kapso",
      installationId: openedEvent.installationId,
      senderId: openedEvent.senderId,
      chatId: openedEvent.chatId,
    })
  );
  expect(binding.conversationScope).toBe(
    "group:kapso:123456789:group-id-redacted"
  );

  const { mentions: _mentions, ...messageWithoutMentions } = mentioned.message;
  const closed = await Effect.runPromise(
    parseKapsoWebhook(
      {
        ...mentioned,
        message: {
          ...messageWithoutMentions,
          kapso: {
            direction: "inbound",
            status: "received",
            origin: "cloud_api",
          },
        },
      },
      kapsoInstallation,
      nowMs
    )
  );
  expect(closed).toEqual([]);

  writeFileSync(
    `${ARTIFACT_DIR}/11-fixture-kapso-mention-gate.json`,
    JSON.stringify(
      {
        surface: "kapso-group-mention-fixture",
        opened: opened.length === 1,
        closedWithoutSignals: closed.length === 0,
        bindingScope: binding.conversationScope,
        productNote:
          "Typical Kapso docs omit mention fields; gate stays closed until signals exist",
      },
      null,
      2
    )
  );
});
