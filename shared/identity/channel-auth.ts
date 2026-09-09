import { Schema } from "effect";

export const channelProviderSchema = Schema.Literals(["telegram", "kapso"]);
const challengeId = Schema.String.check(Schema.isUUID(4));

export const channelChallengeRequestSchema = Schema.Struct({
  channel: channelProviderSchema,
  purpose: Schema.Literals(["login", "link"]),
});

export const channelChallengeSchema = Schema.Struct({
  id: challengeId,
  channel: channelProviderSchema,
  deepLink: Schema.String,
  expiresAt: Schema.String,
}).check(
  Schema.makeFilter(({ channel, deepLink, expiresAt }) => {
    const expectedHost = channel === "telegram" ? "t.me" : "wa.me";
    const prefix = `https://${expectedHost}/`;
    const link = URL.parse(deepLink);
    if (
      !deepLink.startsWith(prefix) ||
      deepLink.includes("\\") ||
      Array.from(deepLink).some(
        (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          /\s/u.test(character)
      ) ||
      link?.protocol !== "https:" ||
      link.hostname !== expectedHost ||
      link.port !== "" ||
      link.username !== "" ||
      link.password !== "" ||
      link.hash !== ""
    )
      return {
        path: ["deepLink"],
        issue: "Expected a channel-matched HTTPS messenger link.",
      };
    const expiry = Date.parse(expiresAt);
    if (
      !Number.isFinite(expiry) ||
      new Date(expiry).toISOString() !== expiresAt
    ) {
      return {
        path: ["expiresAt"],
        issue: "Expected a finite ISO UTC expiry.",
      };
    }
    return true;
  })
);

export const channelChallengeIdSchema = Schema.Struct({ id: challengeId });

export const channelConversationEntrySchema = Schema.Struct({
  channel: Schema.Literal("kapso"),
  conversationUrl: Schema.String.check(
    Schema.makeFilter((value) => {
      const url = URL.parse(value);
      return (
        url?.protocol === "https:" &&
        url.hostname === "wa.me" &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        url.hash === "" &&
        /^\/[1-9][0-9]+$/u.test(url.pathname) &&
        !value.includes("\\")
      );
    })
  ),
});

export const channelStartResultSchema = Schema.Union([
  channelChallengeSchema,
  channelConversationEntrySchema,
]);

export const channelChallengeStatusSchema = Schema.Struct({
  status: Schema.Literals(["pending", "confirmed", "expired", "consumed"]),
});

export const channelChallengeCompletionSchema = Schema.Struct({
  ok: Schema.Literal(true),
});

export const deviceRequestSchema = Schema.Struct({
  id: challengeId,
  purpose: channelChallengeRequestSchema.fields.purpose,
});

export const deviceBindingSchema = Schema.Struct({
  ...deviceRequestSchema.fields,
  token: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)),
});
export const deviceBoundSchema = Schema.Struct({
  ...deviceRequestSchema.fields,
  channel: channelProviderSchema,
  expiresAt: Schema.String,
});
