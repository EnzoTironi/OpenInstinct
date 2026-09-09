import { Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { parseTelegramUpdate } from "./telegram";
import { readVerifiedWebhook } from "./webhook";

const testSecret = Redacted.make("unit-test-webhook-secret");
const now = 1_800_000_000_000;
const installation = { botId: "123456", botUsername: "CompanionBot" };

describe("Telegram private delivery qualification (fixture)", () => {
  it("secret-token webhook auth then private-chat parse yields one inbound message", async () => {
    const body = JSON.stringify({
      update_id: 9001,
      message: {
        message_id: 51,
        date: now / 1000,
        from: { id: 789012, is_bot: false },
        chat: { id: 789012, type: "private" },
        text: "qual private hello",
      },
    });
    const request = new Request("https://test.invalid/channels/telegram", {
      method: "POST",
      body,
      headers: {
        "x-telegram-bot-api-secret-token": Redacted.value(testSecret),
      },
    });
    const verified = await Effect.runPromise(
      readVerifiedWebhook(request, "telegram", testSecret)
    );
    const events = await Effect.runPromise(
      parseTelegramUpdate(verified, installation, now)
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "telegram",
      installationId: "123456",
      eventId: "9001",
      senderId: "789012",
      messageId: "51",
      kind: "message",
      payload: { text: "qual private hello" },
    });
  });

  it("authenticated group chat updates stay out of private delivery", async () => {
    const body = JSON.stringify({
      update_id: 9002,
      message: {
        message_id: 52,
        date: now / 1000,
        from: { id: 789012, is_bot: false },
        chat: { id: -100123, type: "group" },
        text: "group noise",
      },
    });
    const verified = await Effect.runPromise(
      readVerifiedWebhook(
        new Request("https://test.invalid/channels/telegram", {
          method: "POST",
          body,
          headers: {
            "x-telegram-bot-api-secret-token": Redacted.value(testSecret),
          },
        }),
        "telegram",
        testSecret
      )
    );
    expect(
      await Effect.runPromise(parseTelegramUpdate(verified, installation, now))
    ).toEqual([]);
  });
});
