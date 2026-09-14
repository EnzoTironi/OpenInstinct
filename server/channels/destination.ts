import { Config, Effect, Schema } from "effect";
import type { channelProviderSchema } from "../../shared/identity/channel-auth";
import { isE164PhoneNumber } from "../../shared/identity/phone-number";

const InstallationId = Schema.NonEmptyString.check(Schema.isTrimmed());
const TelegramUsername = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]{4,31}$/u)
);
const WhatsAppNumber = Schema.String.check(
  Schema.isPattern(/^\+[1-9][0-9]{6,14}$/u)
);
const TelegramCapability = Schema.Struct({
  installationId: InstallationId,
  username: TelegramUsername,
});
const KapsoCapability = Schema.Struct({
  installationId: InstallationId,
  phoneNumber: WhatsAppNumber,
});

export const channelDestination = Effect.fn("channelDestination")(function* (
  channel: typeof channelProviderSchema.Type
) {
  if (channel === "telegram") {
    const values = yield* Config.all({
      installationId: Config.string("TELEGRAM_BOT_ID"),
      username: Config.string("TELEGRAM_BOT_USERNAME"),
    });
    const capability =
      yield* Schema.decodeUnknownEffect(TelegramCapability)(values);
    return {
      installationId: capability.installationId,
      url: `https://t.me/${capability.username}`,
      parameter: "start",
    };
  }
  const values = yield* Config.all({
    installationId: Config.string("KAPSO_PHONE_NUMBER_ID"),
    phoneNumber: Config.string("KAPSO_PHONE_NUMBER"),
  });
  const capability = yield* Schema.decodeUnknownEffect(KapsoCapability)(values);
  return {
    installationId: capability.installationId,
    url: `https://wa.me/${capability.phoneNumber.slice(1)}`,
    parameter: "text",
  };
});

export const conversationDestinations = Effect.all({
  whatsapp: Config.string("MARKETING_WHATSAPP_NUMBER").pipe(
    Config.orElse(() => Config.string("KAPSO_PHONE_NUMBER")),
    Effect.flatMap(Schema.decodeUnknownEffect(WhatsAppNumber)),
    Effect.map((phoneNumber) => {
      const url = new URL(`https://wa.me/${phoneNumber.slice(1)}`);
      url.searchParams.set("text", "Oi, Zoen!");
      return url.href;
    }),
    Effect.catch(() => Effect.succeed(null))
  ),
  telegram: Config.string("MARKETING_TELEGRAM_USERNAME").pipe(
    Config.orElse(() => Config.string("TELEGRAM_BOT_USERNAME")),
    Effect.flatMap(Schema.decodeUnknownEffect(TelegramUsername)),
    Effect.map((username) => `https://t.me/${username}`),
    Effect.catch(() => Effect.succeed(null))
  ),
  imessage: Config.string("LINQ_CONNECTOR").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(InstallationId)),
    Effect.flatMap(() =>
      Config.string("MARKETING_IMESSAGE_NUMBER").pipe(
        Config.orElse(() => Config.string("LINQ_PHONE_NUMBER"))
      )
    ),
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.String.check(Schema.makeFilter(isE164PhoneNumber))
      )
    ),
    Effect.map((phoneNumber) => `sms:${phoneNumber}`),
    Effect.catch(() => Effect.succeed(null))
  ),
});
