import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Duration, Effect, Redacted, Schema } from "effect";
import { account, db, session, user, verification } from "@db";
import { betterAuthBaseURL } from "@shared/environment/origin";
import { env } from "@shared/environment";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { channelAuthPlugin } from "../../../server/channel-auth";
import { serverRuntime } from "../../../server/runtime";
import * as oauthSchema from "@db/schema/oauth";
import {
  provisionVaultwardenClient,
  vaultwardenAuthPlugins,
} from "./vaultwarden";

export class AuthUnavailable extends Schema.TaggedError<AuthUnavailable>()(
  "AuthUnavailable",
  {}
) {}

const initializeAuth = Effect.fn("initializeAuth")(function* () {
  yield* provisionVaultwardenClient().pipe(
    Effect.mapError(() => new AuthUnavailable())
  );
  const { betterAuthSecret } = yield* Effect.tryPromise({
    try: () => getInstallationSecrets(),
    catch: () => new AuthUnavailable(),
  });
  return yield* Effect.try({
    try: () =>
      betterAuth({
        appName: "Zoen",
        baseURL: betterAuthBaseURL(),
        advanced: { disableOriginCheck: false, disableCSRFCheck: false },
        database: drizzleAdapter(db, {
          provider: "pg",
          schema: { account, session, user, verification, ...oauthSchema },
        }),
        socialProviders:
          env.GOOGLE_CLIENT_ID !== undefined &&
          env.GOOGLE_CLIENT_SECRET !== undefined
            ? {
                google: {
                  clientId: env.GOOGLE_CLIENT_ID,
                  clientSecret: Redacted.value(env.GOOGLE_CLIENT_SECRET),
                  accessType: "offline",
                  prompt: "select_account",
                  includeGrantedScopes: false,
                },
              }
            : {},
        account: {
          encryptOAuthTokens: true,
          // Signing in must not replace the separate Gmail/Calendar grant.
          updateAccountOnSignIn: false,
          accountLinking: {
            enabled: true,
            disableImplicitLinking: true,
            allowDifferentEmails: true,
            allowUnlinkingAll: true,
          },
        },
        databaseHooks: {
          user: {
            create: {
              before: async (identity) =>
                identity.emailVerified &&
                (env.ZOEN_REGISTRATION_MODE === "open" ||
                  env.ZOEN_BETA_IDENTITIES.includes(
                    `google:${identity.email.toLowerCase()}`
                  )),
            },
          },
        },
        disabledPaths: [
          "/token",
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
          "/sign-up/email",
          "/verify-email",
        ],
        plugins: [
          channelAuthPlugin(serverRuntime.runPromise),
          ...vaultwardenAuthPlugins(),
        ],
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
