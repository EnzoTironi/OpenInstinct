import { createHash } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { Effect, Redacted, Schema } from "effect";
import { db, oauthClient, user } from "@db";
import { env } from "@shared/environment";

const clientId = "zoen-vaultwarden";
const scopes = ["openid", "email", "profile", "offline_access"];
const hashClientSecret = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

class VaultIdentityUnavailable extends Schema.TaggedError<VaultIdentityUnavailable>()(
  "VaultIdentityUnavailable",
  {}
) {}

const vaultIdentityClaims = Effect.fn("vaultIdentityClaims")(function* (
  identity: Pick<typeof user.$inferSelect, "id">
) {
  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(and(eq(user.id, identity.id), eq(user.emailVerified, true)))
        .limit(1),
    catch: () => new VaultIdentityUnavailable(),
  });
  const current = rows[0];
  if (!current) return yield* new VaultIdentityUnavailable();
  return { email: current.email, email_verified: true, name: current.name };
});

const claims = (identity: Pick<typeof user.$inferSelect, "id">) =>
  Effect.runPromise(
    vaultIdentityClaims(identity).pipe(
      Effect.mapError(
        () =>
          new APIError("FORBIDDEN", {
            message: "A verified Zoen account is required.",
          })
      )
    )
  );

export const vaultwardenAuthPlugins = () =>
  env.ZOEN_VAULTWARDEN_URL && env.ZOEN_VAULTWARDEN_CLIENT_SECRET
    ? [
        jwt({
          jwks: { keyPairConfig: { alg: "RS256" } },
          disableSettingJwtHeader: true,
        }),
        oauthProvider({
          loginPage: "/vault/sign-in",
          consentPage: "/vault/sign-in",
          scopes,
          grantTypes: ["authorization_code", "refresh_token"],
          allowDynamicClientRegistration: false,
          allowUnauthenticatedClientRegistration: false,
          clientPrivileges: () => false,
          resourcePrivileges: () => false,
          cachedTrustedClients: new Set([clientId]),
          storeClientSecret: { hash: hashClientSecret },
          accessTokenExpiresIn: 300,
          refreshTokenExpiresIn: 86_400,
          customIdTokenClaims: ({ user: identity }) => claims(identity),
          customUserInfoClaims: ({ user: identity }) => claims(identity),
          customAccessTokenClaims: ({ user: identity }) => {
            if (!identity) throw new APIError("FORBIDDEN");
            return claims(identity).then(() => ({}));
          },
        }),
      ]
    : [];

/** One immutable first-party client; no public or user-managed client registration. */
export const provisionVaultwardenClient = Effect.fn(
  "provisionVaultwardenClient"
)(function* () {
  const url = env.ZOEN_VAULTWARDEN_URL;
  const secret = env.ZOEN_VAULTWARDEN_CLIENT_SECRET;
  if (!url || !secret) return;
  const client = {
    clientId,
    clientSecret: hashClientSecret(Redacted.value(secret)),
    name: "Zoen Vault",
    scopes,
    disabled: false,
    skipConsent: true,
    enableEndSession: false,
    tokenEndpointAuthMethod: "client_secret_basic",
    applicationType: "web",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    redirectUris: [`${url}/identity/connect/oidc-signin`],
    requirePKCE: true,
  };
  yield* Effect.tryPromise({
    try: () =>
      db
        .insert(oauthClient)
        .values({ id: clientId, ...client })
        .onConflictDoUpdate({ target: oauthClient.clientId, set: client }),
    catch: () => new VaultIdentityUnavailable(),
  });
});
