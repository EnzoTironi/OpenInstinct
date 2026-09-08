import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Duration, Effect, Schema } from "effect";
import { account, db, session, user, verification } from "@db";
import { betterAuthBaseURL } from "@shared/environment/origin";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { channelAuthPlugin } from "../../../server/channel-auth";
import { serverRuntime } from "../../../server/runtime";

export class AuthUnavailable extends Schema.TaggedError<AuthUnavailable>()(
  "AuthUnavailable",
  {}
) {}

const initializeAuth = Effect.fn("initializeAuth")(function* () {
  const { betterAuthSecret } = yield* Effect.tryPromise({
    try: () => getInstallationSecrets(),
    catch: () => new AuthUnavailable(),
  });
  return yield* Effect.try({
    try: () =>
      betterAuth({
        appName: "Companion",
        baseURL: betterAuthBaseURL(),
        database: drizzleAdapter(db, {
          provider: "pg",
          schema: { account, session, user, verification },
        }),
        disabledPaths: [
          "/change-email",
          "/request-password-reset",
          "/reset-password",
          "/reset-password/:token",
          "/send-verification-email",
          "/sign-in/email",
          "/sign-in/social",
          "/sign-up/email",
          "/verify-email",
        ],
        plugins: [channelAuthPlugin(serverRuntime.runPromise)],
        secret: betterAuthSecret,
      }),
    catch: () => new AuthUnavailable(),
  });
});

const [cachedAuth, invalidateAuth] = Effect.runSync(
  Effect.cachedInvalidateWithTTL(initializeAuth(), Duration.infinity)
);

export const authentication = cachedAuth.pipe(
  Effect.tapError(() => invalidateAuth)
);

export function getAuth() {
  return Effect.runPromise(authentication);
}
