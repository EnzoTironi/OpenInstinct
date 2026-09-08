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

export const channelChallengeStatusSchema = Schema.Struct({
  status: Schema.Literals(["pending", "confirmed", "expired", "consumed"]),
});

export const channelChallengeCompletionSchema = Schema.Struct({
  ok: Schema.Literal(true),
});
