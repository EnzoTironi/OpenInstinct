import { Effect, type Schema } from "effect";
import { describe, expect, it, test } from "vitest";
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  ProviderInputError,
  ProviderRejected,
  ProviderRetryable,
  ProviderUncertain,
} from "./provider-errors";
import { parseTelegramUpdate, telegramSendFailure } from "./telegram";

const now = 1_800_000_000_000;
const installation = { botId: "123456", botUsername: "CompanionBot" };
const token = "a".repeat(43);
const baseMessage = {
  message_id: 51,
  date: now / 1000,
  from: { id: 789012, is_bot: false },
  chat: { id: 789012, type: "private" },
};
const parse = (value: Schema.Json) =>
  Effect.runPromise(parseTelegramUpdate(value, installation, now));

test.each(["/start", "/start@CompanionBot"])(
  "%s opens an ordinary conversation",
  async (text) => {
    expect(
      (await parse({ update_id: 98, message: { ...baseMessage, text } }))[0]
    ).toMatchObject({ kind: "message", payload: { text } });
  }
);

test("confirm still requires proof", async () => {
  await expect(
    parse({ update_id: 98, message: { ...baseMessage, text: "/confirm" } })
  ).rejects.toMatchObject({ reason: "invalid_command" });
});

test("preserves update and sender IDs and separates login tokens from messages", async () => {
  const events = await parse({
    update_id: 99,
    message: { ...baseMessage, text: `/start ${token}` },
  });
  expect(events).toEqual([
    {
      channel: "telegram",
      installationId: "123456",
      eventId: "99",
      senderId: "789012",
      messageId: "51",
      occurredAt: "2027-01-15T08:00:00.000Z",
      chatKind: "private",
      chatId: "789012",
      kind: "command",
      command: "start",
      token,
    },
  ]);
  expect(events[0]).not.toHaveProperty("payload");
  const confirm = await parse({
    update_id: 100,
    message: { ...baseMessage, text: `/confirm@CompanionBot ${token}` },
  });
  expect(confirm[0]).toMatchObject({
    kind: "command",
    command: "confirm",
    token,
  });
});

test("normalizes text and opaque media without downloading or retaining URLs", async () => {
  const events = await parse({
    update_id: 100,
    message: {
      ...baseMessage,
      caption: "look",
      document: {
        file_id: "opaque-file-id",
        mime_type: "image/png",
        file_name: "photo.png",
        url: "https://untrusted.invalid/file",
      },
      reply_to_message: { message_id: 42 },
    },
  });
  expect(events[0]).toMatchObject({
    kind: "message",
    payload: {
      text: "look",
      replyToMessageId: "42",
      attachments: [
        { id: "opaque-file-id", mediaType: "image/png", name: "photo.png" },
      ],
    },
  });
  expect(JSON.stringify(events)).not.toContain("https://");
  expect(
    (
      await parse({
        update_id: 101,
        message: { ...baseMessage, text: "hello" },
      })
    )[0]
  ).toMatchObject({ kind: "message", payload: { text: "hello" } });
});

test("ignores bots, unmentioned groups, edited updates, mismatched private senders and other bot commands", async () => {
  const ignored: Schema.Json[] = [
    {
      update_id: 1,
      message: {
        ...baseMessage,
        text: "hello",
        from: { id: 789012, is_bot: true },
      },
    },
    {
      update_id: 2,
      message: {
        ...baseMessage,
        text: "hello",
        chat: { id: -1, type: "group" },
      },
    },
    { update_id: 3, edited_message: { ...baseMessage, text: "hello" } },
    {
      update_id: 4,
      message: {
        ...baseMessage,
        text: "hello",
        chat: { id: 789013, type: "private" },
      },
    },
    {
      update_id: 5,
      message: { ...baseMessage, text: `/start@AnotherBot ${token}` },
    },
  ];
  expect(await Promise.all(ignored.map(parse))).toEqual(ignored.map(() => []));
});

test("only accepts private confirmation callbacks on this bot's own message", async () => {
  const query = {
    id: "query-1",
    from: baseMessage.from,
    message: { ...baseMessage, from: { id: 123456, is_bot: true } },
    data: `confirm:${token}`,
  };
  const events = await parse({ update_id: 17, callback_query: query });
  expect(events[0]).toMatchObject({
    kind: "command",
    command: "confirm",
    callbackQueryId: "query-1",
    token,
    eventId: "17",
  });
  expect(events[0]).not.toHaveProperty("payload");
  expect(
    await parse({
      update_id: 18,
      callback_query: { ...query, from: { id: 555555, is_bot: false } },
    })
  ).toEqual([]);
  expect(
    await parse({
      update_id: 19,
      callback_query: {
        ...query,
        message: { ...query.message, from: { id: 987654, is_bot: true } },
      },
    })
  ).toEqual([]);
});

test("rejects stale/future events and malformed login commands without effects", async () => {
  await Promise.all(
    [now / 1000 - 86_401, now / 1000 + 61].map(async (date) => {
      await expect(
        parse({
          update_id: 10,
          message: { ...baseMessage, date, text: "hello" },
        })
      ).rejects.toBeInstanceOf(ProviderInputError);
    })
  );
  await expect(
    parse({
      update_id: 11,
      message: { ...baseMessage, text: "/start short extra" },
    })
  ).rejects.toBeInstanceOf(ProviderInputError);
  expect(
    await parse({
      update_id: 12,
      message: { ...baseMessage, date: now / 1000 - 86_400, text: "delayed" },
    })
  ).toHaveLength(1);
});

describe("telegram private send failure classification", () => {
  it("promotes application-level 429 + retry_after to ProviderRetryable", () => {
    const error = telegramSendFailure({
      error_code: 429,
      parameters: { retry_after: 14 },
    });
    expect(error).toBeInstanceOf(ProviderRetryable);
    expect(error).toMatchObject({
      provider: "telegram",
      status: 429,
      retryAfterSeconds: 14,
    });
  });

  it("defaults retry_after when Telegram omits parameters on 429", () => {
    const error = telegramSendFailure({ error_code: 429 });
    expect(error).toBeInstanceOf(ProviderRetryable);
    expect(error).toMatchObject({
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
  });

  it("keeps permanent 4xx as ProviderRejected", () => {
    const error = telegramSendFailure({ error_code: 403 });
    expect(error).toBeInstanceOf(ProviderRejected);
    expect(error).toMatchObject({ status: 403 });
  });

  it("keeps ambiguous non-4xx as ProviderUncertain", () => {
    expect(telegramSendFailure({ error_code: 500 })).toBeInstanceOf(
      ProviderUncertain
    );
    expect(telegramSendFailure({ error_code: 408 })).toBeInstanceOf(
      ProviderUncertain
    );
  });
});

test("group mention foundation accepts @mention and reply-to-bot; private still works", async () => {
  const groupChat = { id: -100123, type: "supergroup" as const };
  const mentioned = await parse({
    update_id: 200,
    message: {
      ...baseMessage,
      chat: groupChat,
      text: "hey @CompanionBot summarize",
      entities: [{ type: "mention", offset: 4, length: 14 }],
    },
  });
  expect(mentioned).toHaveLength(1);
  expect(mentioned[0]).toMatchObject({
    kind: "message",
    chatKind: "group",
    chatId: "-100123",
    senderId: "789012",
    payload: { text: "hey @CompanionBot summarize" },
  });

  const replied = await parse({
    update_id: 201,
    message: {
      ...baseMessage,
      chat: groupChat,
      text: "follow up",
      reply_to_message: {
        message_id: 9,
        from: { id: 123456, is_bot: true },
      },
    },
  });
  expect(replied[0]).toMatchObject({
    kind: "message",
    chatKind: "group",
    chatId: "-100123",
    payload: { text: "follow up" },
  });

  // Login commands never mint from groups even when mentioned.
  expect(
    await parse({
      update_id: 202,
      message: {
        ...baseMessage,
        chat: groupChat,
        text: `/start@CompanionBot ${token}`,
      },
    })
  ).toEqual([]);

  // Private regression still emits chatKind/chatId.
  const privateMessage = await parse({
    update_id: 203,
    message: { ...baseMessage, text: "still private" },
  });
  expect(privateMessage[0]).toMatchObject({
    kind: "message",
    chatKind: "private",
    chatId: "789012",
    payload: { text: "still private" },
  });
});
