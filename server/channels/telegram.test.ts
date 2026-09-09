import { Effect, type Schema } from "effect";
import { expect, test } from "vitest";
import { ProviderInputError } from "./provider-errors";
import { parseTelegramUpdate } from "./telegram";

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

test("ignores bots, groups, edited updates, mismatched private senders and other bot commands", async () => {
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
