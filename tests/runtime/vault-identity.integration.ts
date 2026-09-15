import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import { Effect, Layer, Redacted, Schema } from "effect";
import { expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { getAuth } from "@db/services/auth";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const base = "https://zoen-vault-identity.example.invalid";
const vault = "https://vault-identity.example.invalid";
const clientSecret = "synthetic-vault-oidc-client-secret-for-integration";
vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      BETTER_AUTH_URL: "https://zoen-vault-identity.example.invalid",
      ZOEN_VAULTWARDEN_URL: "https://vault-identity.example.invalid",
      ZOEN_VAULTWARDEN_CLIENT_SECRET: Redacted.make(
        "synthetic-vault-oidc-client-secret-for-integration"
      ),
    },
  };
});
const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
const tokensSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  id_token: Schema.String,
});

test("Vaultwarden OIDC binds the verified person, requires PKCE and retires tokens with the Zoen session", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor } = yield* workspaceFixture();
      const id = actor.userId.replace(/^better-auth:/, "");
      yield* sql`UPDATE public.user SET "emailVerified" = true WHERE id = ${id}`;
      const auth = yield* Effect.promise(getAuth);
      const { betterAuthSecret } = yield* Effect.promise(
        getInstallationSecrets
      );
      const signature = createHmac("sha256", betterAuthSecret)
        .update(actor.authSessionId)
        .digest("base64");
      const cookie = `__Secure-better-auth.session_token=${encodeURIComponent(`${actor.authSessionId}.${signature}`)}`;
      const request = (path: string, body?: URLSearchParams) =>
        auth.handler(
          new Request(`${base}/api/auth${path}`, {
            method: body ? "POST" : "GET",
            headers: body
              ? {
                  "content-type": "application/x-www-form-urlencoded",
                  authorization: `Basic ${Buffer.from(`zoen-vaultwarden:${clientSecret}`).toString("base64")}`,
                }
              : { cookie },
            body,
          })
        );
      const metadata = yield* Effect.promise(() =>
        request("/.well-known/openid-configuration")
      );
      expect(metadata.status).toBe(200);
      const discovery = Schema.decodeUnknownSync(Schema.Json)(
        yield* Effect.promise(() => metadata.json())
      );
      expect(discovery).toMatchObject({
        issuer: `${base}/api/auth`,
        grant_types_supported: ["authorization_code", "refresh_token"],
      });
      const verifier = randomBytes(32).toString("base64url");
      const query = new URLSearchParams({
        client_id: "zoen-vaultwarden",
        redirect_uri: `${vault}/identity/connect/oidc-signin`,
        response_type: "code",
        scope: "openid email profile offline_access",
        state: "synthetic-state",
        nonce: "synthetic-nonce",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      });
      const authorize = yield* Effect.promise(() =>
        request(`/oauth2/authorize?${query}`)
      );
      expect(authorize.status).toBe(302);
      const destination = new URL(authorize.headers.get("location") ?? base);
      expect(destination.origin).toBe(vault);
      expect(destination.searchParams.get("state")).toBe("synthetic-state");
      const code = destination.searchParams.get("code");
      expect(code).toBeTruthy();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        redirect_uri: `${vault}/identity/connect/oidc-signin`,
        code_verifier: verifier,
      });
      const exchanged = yield* Effect.promise(() =>
        request("/oauth2/token", body)
      );
      expect(exchanged.status).toBe(200);
      const tokens = Schema.decodeUnknownSync(tokensSchema)(
        yield* Effect.promise(() => exchanged.json())
      );
      const wrongSecret = yield* Effect.promise(() =>
        auth.handler(
          new Request(`${base}/api/auth/oauth2/token`, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              authorization: `Basic ${Buffer.from("zoen-vaultwarden:incorrect-client-secret").toString("base64")}`,
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: tokens.refresh_token,
            }),
          })
        )
      );
      expect(wrongSecret.status).toBeGreaterThanOrEqual(400);
      const info = yield* Effect.promise(() =>
        auth.handler(
          new Request(`${base}/api/auth/oauth2/userinfo`, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
          })
        )
      );
      expect(info.status).toBe(200);
      expect(yield* Effect.promise(() => info.json())).toMatchObject({
        sub: id,
        email_verified: true,
      });
      const [header, payload, signed] = tokens.id_token.split(".");
      if (!header || !payload || !signed) throw new Error("ID token missing");
      const claims = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Json)
      )(Buffer.from(payload, "base64url").toString());
      expect(claims).toMatchObject({
        sub: id,
        iss: `${base}/api/auth`,
        aud: "zoen-vaultwarden",
        nonce: "synthetic-nonce",
        email_verified: true,
      });
      const jwks = yield* Effect.promise(() => request("/jwks"));
      const keys = Schema.decodeUnknownSync(
        Schema.Struct({
          keys: Schema.Array(
            Schema.Struct({
              kty: Schema.String,
              n: Schema.String,
              e: Schema.String,
            })
          ),
        })
      )(yield* Effect.promise(() => jwks.json()));
      expect(keys.keys).toHaveLength(1);
      const key = keys.keys[0];
      if (!key) throw new Error("Signing key missing");
      expect(
        verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          createPublicKey({ key, format: "jwk" }),
          Buffer.from(signed, "base64url")
        )
      ).toBe(true);
      const replay = yield* Effect.promise(() =>
        request("/oauth2/token", body)
      );
      expect(replay.status).toBeGreaterThanOrEqual(400);
      const malicious = new URLSearchParams(query);
      malicious.set("redirect_uri", "https://other.example.invalid/callback");
      const redirectDenied = yield* Effect.promise(() =>
        request(`/oauth2/authorize?${malicious}`)
      );
      expect(redirectDenied.headers.get("location")).toMatch(
        /^https:\/\/zoen-vault-identity\.example\.invalid\/api\/auth\/error\?/
      );
      const missingPkce = new URLSearchParams(query);
      missingPkce.delete("code_challenge");
      missingPkce.delete("code_challenge_method");
      const pkceDenied = yield* Effect.promise(() =>
        request(`/oauth2/authorize?${missingPkce}`)
      );
      expect(pkceDenied.headers.get("location") ?? "").not.toContain("?code=");
      expect(pkceDenied.status).not.toBe(200);
      const registration = yield* Effect.promise(() =>
        auth.handler(
          new Request(`${base}/api/auth/oauth2/register`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie,
              origin: base,
            },
            body: JSON.stringify({
              redirect_uris: ["https://other.example.invalid"],
            }),
          })
        )
      );
      expect(registration.status).toBeGreaterThanOrEqual(400);
      const invalidVerifier = yield* Effect.promise(() =>
        request(`/oauth2/authorize?${query}`)
      );
      const challengedCode = new URL(
        invalidVerifier.headers.get("location") ?? base
      ).searchParams.get("code");
      const verifierDenied = yield* Effect.promise(() =>
        request(
          "/oauth2/token",
          new URLSearchParams({
            grant_type: "authorization_code",
            code: challengedCode ?? "",
            redirect_uri: `${vault}/identity/connect/oidc-signin`,
            code_verifier: randomBytes(32).toString("base64url"),
          })
        )
      );
      expect(verifierDenied.status).toBeGreaterThanOrEqual(400);
      yield* sql`UPDATE public.user SET "emailVerified" = false WHERE id = ${id}`;
      const unverified = yield* Effect.promise(() =>
        auth.handler(
          new Request(`${base}/api/auth/oauth2/userinfo`, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
          })
        )
      );
      expect(unverified.status).toBeGreaterThanOrEqual(400);
      yield* sql`UPDATE public.user SET "emailVerified" = true WHERE id = ${id}`;
      yield* sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`;
      const revoked = yield* Effect.promise(() =>
        request(
          "/oauth2/token",
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
          })
        )
      );
      expect(revoked.status).toBeGreaterThanOrEqual(400);
      const credentials =
        yield* sql`SELECT id FROM oauth_refresh_token WHERE user_id = ${id}`;
      expect(credentials).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
