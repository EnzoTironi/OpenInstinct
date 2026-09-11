import { createHmac } from "node:crypto";

import { Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { parseKapsoWebhook } from "./kapso";
import { readVerifiedWebhook } from "./webhook";

const testSecret = Redacted.make("unit-test-webhook-secret");

const now = 1_800_000_000_000;

const installation = {
  phoneNumberId: "123456789",
  phoneNumber: "+15550001111",
};

const signedRequest = (body: string) => {
  const signature = createHmac("sha256", Redacted.value(testSecret))
    .update(body)
    .digest("hex");

  return new Request("https://test.invalid/channels/kapso", {
    method: "POST",
    body,
    headers: { "x-webhook-signature": signature },
  });
};

describe("Kapso private delivery qualification (fixture)", () => {
  it("HMAC webhook auth then private inbound parse yields one message", async () => {
    const body = JSON.stringify({
      phone_number_id: installation.phoneNumberId,
      message: {
        id: "wamid.qual-private",
        timestamp: String(now / 1000),
        type: "text",
        from: "15550002222",
        text: { body: "qual private hello" },
        kapso: {
          direction: "inbound",
          status: "received",
          origin: "cloud_api",
        },
      },
      conversation: {
        phone_number_id: installation.phoneNumberId,
        phone_number: "+15550002222",
      },
    });

    const verified = await Effect.runPromise(
      readVerifiedWebhook(signedRequest(body), "kapso", testSecret)
    );

    const events = await Effect.runPromise(
      parseKapsoWebhook(verified, installation, now)
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "kapso",
      installationId: "123456789",
      eventId: "wamid.qual-private",
      senderId: "15550002222",
      messageId: "wamid.qual-private",
      kind: "message",
      payload: { text: "qual private hello" },
    });
  });

  it("authenticated group conversations stay out of private delivery", async () => {
    const body = JSON.stringify({
      phone_number_id: installation.phoneNumberId,
      message: {
        id: "wamid.qual-group",
        timestamp: String(now / 1000),
        type: "text",
        from: "15550002222",
        text: { body: "group noise" },
        kapso: {
          direction: "inbound",
          status: "received",
          origin: "cloud_api",
        },
      },
      conversation: {
        phone_number_id: installation.phoneNumberId,
        phone_number: "+15550002222",
        is_group: true,
        type: "group",
      },
    });

    const verified = await Effect.runPromise(
      readVerifiedWebhook(signedRequest(body), "kapso", testSecret)
    );

    expect(
      await Effect.runPromise(parseKapsoWebhook(verified, installation, now))
    ).toEqual([]);
  });
});
