import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { channelChallengeSchema } from "./channel-auth";

const challenge = {
  id: "59714494-2256-4f61-ae24-eeb86863fc10",
  channel: "telegram",
  deepLink: "https://t.me/ExampleBot?start=opaque",
  expiresAt: "2026-09-08T12:00:00.000Z",
};

describe("channel login links", () => {
  it("accepts channel-matched HTTPS destinations and canonical expiry", () => {
    expect(Schema.is(channelChallengeSchema)(challenge)).toBe(true);
    expect(
      Schema.is(channelChallengeSchema)({
        ...challenge,
        channel: "kapso",
        deepLink: "https://wa.me/15555550100?text=opaque",
      })
    ).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "http://t.me/ExampleBot",
    "https://wa.me/15555550100",
    "https://t.me.evil.invalid/ExampleBot",
    "https://user:pass@t.me/ExampleBot",
    "https://t.me:443/ExampleBot",
    "https://t.me/ExampleBot#fragment",
    "https://t.me/Example\\Bot",
    "https://t.me/Example\nBot",
    "https://t.me/Example\u0000Bot",
  ])("rejects an unsafe or mismatched link: %j", (deepLink) => {
    expect(Schema.is(channelChallengeSchema)({ ...challenge, deepLink })).toBe(
      false
    );
  });

  it.each(["invalid", "2026-02-31T12:00:00.000Z", "2026-09-08", "Infinity"])(
    "rejects invalid expiry: %s",
    (expiresAt) => {
      expect(
        Schema.is(channelChallengeSchema)({ ...challenge, expiresAt })
      ).toBe(false);
    }
  );
});
