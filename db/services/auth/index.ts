import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Duration, Effect, Redacted, Schema } from "effect";
import { account, db, session, user, verification } from "@db";
import { betterAuthBaseURL } from "@shared/environment/origin";
import { env } from "@shared/environment";
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
        socialProviders:
          env.GOOGLE_CLIENT_ID !== undefined &&
          env.GOOGLE_CLIENT_SECRET !== undefined
            ? {
                google: {
                  clientId: env.GOOGLE_CLIENT_ID,
                  clientSecret: Redacted.value(env.GOOGLE_CLIENT_SECRET),
                  accessType: "offline",
                  prompt: "consent",
                  disableSignUp: true,
                },
              }
            : {},
        account: {
          encryptOAuthTokens: true,
          accountLinking: {
            enabled: true,
            disableImplicitLinking: true,
            allowDifferentEmails: true,
            allowUnlinkingAll: true,
          },
        },
        disabledPaths: [
          "/account-info",
          "/change-email",
          "/get-access-token",
          "/refresh-token",
          "/link-social",
          "/unlink-account",
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
