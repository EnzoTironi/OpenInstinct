import { Effect, type Schema } from "effect";
import { expect, test } from "vitest";
import { parseKapsoWebhook } from "./kapso";
import { ProviderInputError } from "./provider-errors";
import receivedDelivery from "./fixtures/kapso-received.redacted.json";

const now = 1_800_000_000_000;
const installation = {
  phoneNumberId: "123456789",
  phoneNumber: "+15550001111",
};
const baseMessage = {
  id: "wamid.incoming",
  timestamp: String(now / 1000),
  type: "text",
  from: "15550002222",
  text: { body: "hello" },
  kapso: { direction: "inbound", status: "received", origin: "cloud_api" },
};
const base = {
  phone_number_id: installation.phoneNumberId,
  message: baseMessage,
  conversation: {
    phone_number_id: installation.phoneNumberId,
    phone_number: "+15550002222",
    contact_name: "Never an identity",
  },
};
const parse = (value: Schema.Json) =>
  Effect.runPromise(parseKapsoWebhook(value, installation, now));

test("preserves wamid/from and ignores display names and derived content", async () => {
  const events = await parse({
    ...base,
    message: {
      ...baseMessage,
      from_user_id: "US.123",
      kapso: {
        ...baseMessage.kapso,
        content: "URL https://untrusted.invalid",
        transcript: { text: "not authoritative" },
      },
    },
  });
  expect(events[0]).toMatchObject({
    kind: "message",
    eventId: "wamid.incoming",
    senderId: "15550002222",
    installationId: "123456789",
    payload: { text: "hello" },
  });
  expect(JSON.stringify(events)).not.toContain("untrusted");
  expect(JSON.stringify(events)).not.toContain("Never an identity");
});

test("normalizes media references and login commands without media URLs or raw token payloads", async () => {
  const media = await parse({
    ...base,
    message: {
      ...baseMessage,
      type: "image",
      image: { id: "media_123", caption: "look" },
      kapso: {
        ...baseMessage.kapso,
        media_url: "https://untrusted.invalid",
        media_data: {
          url: "https://untrusted.invalid",
          content_type: "image/png",
          filename: "photo.png",
        },
      },
    },
  });
  expect(media[0]).toMatchObject({
    kind: "message",
    payload: {
      text: "look",
      attachments: [
        { id: "media_123", mediaType: "image/png", name: "photo.png" },
      ],
    },
  });
  expect(JSON.stringify(media)).not.toContain("https://");
  const token = "a".repeat(43);
  const command = await parse({
    ...base,
    message: { ...baseMessage, text: { body: `/confirm ${token}` } },
  });
  expect(command[0]).toMatchObject({
    kind: "message",
    payload: { text: `/confirm ${token}` },
  });
  expect(command[0]).not.toHaveProperty("token");
});

test("ignores status/outbound/unmentioned-group/system events and rejects unsupported ID-only identity", async () => {
  expect(
    await parse({
      ...base,
      message: {
        ...baseMessage,
        kapso: { direction: "outbound", status: "sent" },
      },
    })
  ).toEqual([]);
  expect(
    await parse({
      ...base,
      message: {
        ...baseMessage,
        kapso: { direction: "outbound", status: "delivered" },
      },
    })
  ).toEqual([]);
  expect(
    await parse({
      ...base,
      conversation: { ...base.conversation, is_group: true },
    })
  ).toEqual([]);
  expect(
    await parse({ ...base, message: { ...baseMessage, type: "system" } })
  ).toEqual([]);
  const idOnly = { ...baseMessage, from_user_id: "US.123" };
  const { from: _phone, ...unsupported } = idOnly;
  await expect(parse({ ...base, message: unsupported })).rejects.toMatchObject({
    reason: "unsupported_identity",
  });
});

test("requires installation and contact consistency", async () => {
  await expect(
    parse({ ...base, phone_number_id: "999999" })
  ).rejects.toMatchObject({ reason: "wrong_installation" });
  await expect(
    parse({
      ...base,
      conversation: { ...base.conversation, phone_number_id: "999999" },
    })
  ).rejects.toMatchObject({ reason: "wrong_installation" });
  await expect(
    parse({
      ...base,
      conversation: { ...base.conversation, phone_number: "15550003333" },
    })
  ).rejects.toMatchObject({ reason: "wrong_installation" });
  await expect(
    parse({ ...base, message: { ...baseMessage, to: "15550003333" } })
  ).rejects.toMatchObject({ reason: "wrong_installation" });
});

test("accepts 100 batched events and rejects larger or stale/future input", async () => {
  const data = Array.from({ length: 100 }, (_, index) => ({
    ...base,
    message: { ...baseMessage, id: `wamid.${String(index)}` },
  }));
  const events = await parse({
    batch: true,
    type: "whatsapp.message.received",
    data,
  });
  expect(events).toHaveLength(100);
  expect(events.at(-1)?.eventId).toBe("wamid.99");
  await expect(
    parse({
      batch: true,
      type: "whatsapp.message.received",
      data: [...data, base],
    })
  ).rejects.toBeInstanceOf(ProviderInputError);
  await Promise.all(
    [now / 1000 - 86_401, now / 1000 + 61].map(async (timestamp) => {
      await expect(
        parse({
          ...base,
          message: { ...baseMessage, timestamp: String(timestamp) },
        })
      ).rejects.toBeInstanceOf(ProviderInputError);
    })
  );
});

test("accepts the provider default batch of 50", async () => {
  const data = Array.from({ length: 50 }, (_, index) => ({
    ...base,
    message: { ...baseMessage, id: `wamid.${String(index)}` },
  }));
  expect(
    await parse({ batch: true, type: "whatsapp.message.received", data })
  ).toHaveLength(50);
});

test.each(["cloud_api", "business_app"])(
  "accepts live %s origin with inbound received direction",
  async (origin) => {
    const kapso = { ...baseMessage.kapso, origin };
    expect(
      await parse({ ...base, message: { ...baseMessage, kapso } })
    ).toHaveLength(1);
    const events = await parse({
      ...base,
      message: {
        ...baseMessage,
        kapso,
        text: { body: `/confirm ${"a".repeat(43)}` },
      },
    });
    expect(events[0]).toMatchObject({
      kind: "message",
      payload: { text: `/confirm ${"a".repeat(43)}` },
    });
    expect(
      await parse({
        ...base,
        message: { ...baseMessage, kapso: { ...kapso, direction: "outbound" } },
      })
    ).toEqual([]);
  }
);

test.each(["history_sync", "unknown_future_origin", undefined])(
  "ignores %s origin before text or login normalization",
  async (origin) => {
    const kapso: Schema.MutableJsonObject = {
      direction: "inbound",
      status: "received",
    };
    if (origin !== undefined) kapso.origin = origin;
    await Promise.all(
      [
        "hello",
        `/confirm ${"a".repeat(43)}`,
        "/confirm invalid",
        `/start ${"a".repeat(43)}`,
      ].map(async (body) => {
        expect(
          await parse({
            ...base,
            message: { ...baseMessage, kapso, text: { body } },
          })
        ).toEqual([]);
      })
    );
  }
);

// Actual delivery 08279d9d-1918-4560-bc64-a4e3d635458e, retrieved from
// Kapso log_search; identifiers and user text redacted, shape/status preserved.
test("accepts the live inbound delivery with null context and delivered status", async () => {
  const events = await Effect.runPromise(
    parseKapsoWebhook(
      receivedDelivery,
      installation,
      Number(receivedDelivery.message.timestamp) * 1000
    )
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "message",
    payload: { text: `/start ${"a".repeat(43)}` },
    senderId: "15550002222",
    installationId: "123456789",
  });
});

test("kapso group mention signals open ingress; bare group stays closed", async () => {
  const { phone_number: _peerPhone, ...groupConversation } = base.conversation;
  const groupBase = {
    ...base,
    conversation: {
      ...groupConversation,
      id: "conv-group",
      is_group: true,
      type: "group",
    },
    message: {
      ...baseMessage,
      group_id: "wa-group-1",
      to: installation.phoneNumber,
      kapso: {
        ...baseMessage.kapso,
        mentioned_business: true,
      },
    },
  };
  const opened = await parse(groupBase);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({
    chatKind: "group",
    chatId: "wa-group-1",
  });
  expect(
    await parse({
      ...groupBase,
      message: {
        ...groupBase.message,
        kapso: {
          direction: "inbound",
          status: "received",
          origin: "cloud_api",
        },
      },
    })
  ).toEqual([]);
});
