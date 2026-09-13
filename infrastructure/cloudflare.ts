import * as Cloudflare from "alchemy/Cloudflare";
import * as Provider from "alchemy/Provider";
import { Config, Effect, Layer } from "effect";

// Cloudflare OAuth deliberately excludes DNS editing. Only this provider gets
// the separate token, restricted to DNS on tironi.xyz; state keeps using OAuth.
const dnsProvider = Provider.effect(
  Cloudflare.DNS.Record,
  Effect.gen(function* () {
    const native = yield* Cloudflare.DNS.Record.Provider;
    const read = native.read?.bind(native);
    if (!read)
      return yield* Effect.die(
        "Native DNS provider must support adoption reads"
      );
    const apiToken = yield* Config.redacted("ZOEN_DNS_API_TOKEN").pipe(
      Effect.orDie
    );
    const credentials = Effect.succeed({
      type: "apiToken" as const,
      apiToken,
      apiBaseUrl: "https://api.cloudflare.com/client/v4",
    });
    // Provider.succeed does not capture construction context. Bind credentials to
    // each operation, so OAuth remains available for the remote state service.
    return {
      ...native,
      read: (args) =>
        read(args).pipe(
          Effect.provideService(Cloudflare.Credentials, credentials)
        ),
      reconcile: (args) =>
        native
          .reconcile(args)
          .pipe(Effect.provideService(Cloudflare.Credentials, credentials)),
      delete: (args) =>
        native
          .delete(args)
          .pipe(Effect.provideService(Cloudflare.Credentials, credentials)),
    };
  })
).pipe(Layer.provide(Cloudflare.DNS.RecordProvider()));

export const cloudflareProviders = Layer.effect(
  Cloudflare.Providers,
  Provider.collection([Cloudflare.DNS.Record])
).pipe(Layer.provide(dnsProvider), Layer.provideMerge(Cloudflare.providers()));
