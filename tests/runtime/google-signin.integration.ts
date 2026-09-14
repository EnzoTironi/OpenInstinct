import assert from "node:assert/strict";
import type { account } from "@db";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { Config, Effect, Redacted, Schema } from "effect";
import { Pool } from "pg";
import { expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import { getAuth } from "@db/services/auth";
import { ensureScope } from "@db/services/scope";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { googleWorkspaceScopes } from "@shared/google-workspace/connection";
import {
  connectGoogleWorkspace,
  disconnectGoogleWorkspace,
  readGoogleWorkspaceConnection,
} from "../../server/google-workspace";
import { runtimeDatabase } from "./database";

vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      BETTER_AUTH_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "google-signin-proof",
      GOOGLE_CLIENT_SECRET: Redacted.make("synthetic-google-secret"),
      ZOEN_REGISTRATION_MODE: "closed",
      ZOEN_BETA_IDENTITIES: [
        "google:invited@zoen.example.invalid",
        "google:unverified@zoen.example.invalid",
      ],
    },
  };
});

const cookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter((value) => !value?.endsWith("="))
    .join("; ");

test("Google creates one identity, enforces beta admission and preserves sign-in when Workspace is disconnected", async () => {
  const databaseURL = await Effect.runPromise(
    Config.string("DATABASE_URL").pipe(Effect.provide(runtimeDatabase))
  );
  const pool = new Pool({ connectionString: databaseURL });
  const auth = await getAuth();
  const baseURL = "http://localhost:3000";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const key = {
    ...publicKey.export({ format: "jwk" }),
    kid: randomUUID(),
    alg: "RS256",
    use: "sig",
  };
  const subject = randomUUID();
  const users = new Set<string>();
  const profile = {
    sub: subject,
    email: "invited@zoen.example.invalid",
    email_verified: true,
  };
  let nonce = "";
  let verifier = "";
  let issuedScopes = "openid email profile";
  const token = (audience = "google-signin-proof", identity = profile) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: key.kid })
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: audience,
        iat: now,
        exp: now + 300,
        nonce,
        name: "Onboarding proof",
        ...identity,
      })
    ).toString("base64url");
    const data = `${header}.${payload}`;
    return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (request.url === "https://www.googleapis.com/oauth2/v3/certs")
        return Response.json({ keys: [key] });
      if (request.url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(await request.text());
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier") ?? "")
            .digest("base64url"),
          verifier
        );
        assert.equal(
          body.get("redirect_uri"),
          `${baseURL}/api/auth/callback/google`
        );
        return Response.json({
          access_token: "synthetic-workspace-access",
          refresh_token: "synthetic-workspace-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: issuedScopes,
          id_token: token(),
        });
      }
      throw new Error(
        `Unexpected OAuth fixture request: ${request.url.split("?")[0] ?? ""}`
      );
    });
  const request = (
    path: string,
    body?: NonNullable<Parameters<typeof auth.api.signInSocial>[0]>["body"],
    browserCookie = ""
  ) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: baseURL,
          "content-type": "application/json",
          cookie: browserCookie,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    );
  const begin = async () => {
    const started = await request("/sign-in/social", {
      provider: "google",
      callbackURL: "/connections",
      disableRedirect: true,
    });
    expect(started.status).toBe(200);
    const result = Schema.decodeUnknownSync(
      Schema.Struct({ url: Schema.String })
    )(await started.json());
    const url = new URL(result.url);
    expect(new Set(url.searchParams.get("scope")?.split(" "))).toEqual(
      new Set(["openid", "email", "profile"])
    );
    expect(url.searchParams.get("include_granted_scopes")).not.toBe("true");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    nonce = url.searchParams.get("nonce") ?? "";
    verifier = url.searchParams.get("code_challenge") ?? "";
    return {
      path: `/callback/google?code=synthetic-code&state=${url.searchParams.get("state") ?? ""}`,
      cookie: cookie(started),
    };
  };
  try {
    const badAudience = await request("/sign-in/social", {
      provider: "google",
      idToken: { token: token("another-client") },
    });
    expect(badAudience.status).toBe(401);
    const started = await begin();
    const foreign = await request("/sign-in/social", {
      provider: "google",
      callbackURL: "https://attacker.invalid",
    });
    expect(foreign.status).toBe(403);
    const completed = await request(started.path, undefined, started.cookie);
    expect(completed.status).toBe(302);
    expect(
      new URL(completed.headers.get("location") ?? "/missing-location", baseURL)
        .href
    ).toBe(`${baseURL}/connections`);
    const browser = cookie(completed);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: browser }),
    });
    expect(session?.user.email).toBe(profile.email);
    if (!session) throw new Error("Google did not create a session");
    users.add(session.user.id);
    const scope = accessScopeForUser(`better-auth:${session.user.id}`);
    await ensureScope(scope);
    expect(
      await Effect.runPromise(
        readGoogleWorkspaceConnection(scope).pipe(
          Effect.provide(runtimeDatabase)
        )
      )
    ).toEqual({ state: "disconnected" });
    const row = await pool.query<{ id: string }>(
      'SELECT id FROM account WHERE "userId" = $1 AND issuer = $2 AND "accountId" = $3',
      [session.user.id, "https://accounts.google.com", subject]
    );
    expect(row.rows).toHaveLength(1);
    const id = row.rows[0]?.id;
    assert.ok(id);
    const headers = new Headers({ cookie: browser, origin: baseURL });
    const grant = await Effect.runPromise(
      connectGoogleWorkspace(headers, "/connections").pipe(
        Effect.provide(runtimeDatabase)
      )
    );
    const grantURL = new URL(grant.url);
    expect(grantURL.searchParams.get("prompt")).toContain("consent");
    expect(grantURL.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/gmail.modify"
    );
    nonce = grantURL.searchParams.get("nonce") ?? "";
    verifier = grantURL.searchParams.get("code_challenge") ?? "";
    issuedScopes = googleWorkspaceScopes.join(" ");
    const linked = await request(
      `/callback/google?code=workspace-code&state=${grantURL.searchParams.get("state") ?? ""}`,
      undefined,
      `${browser}; ${grant.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .filter((value) => !value?.endsWith("="))
        .join("; ")}`
    );
    expect(linked.status).toBe(302);
    expect(
      await Effect.runPromise(
        readGoogleWorkspaceConnection(scope).pipe(
          Effect.provide(runtimeDatabase)
        )
      )
    ).toEqual({ state: "connected" });
    const before = await pool.query<
      Pick<
        typeof account.$inferSelect,
        "accessToken" | "refreshToken" | "scope"
      >
    >(
      'SELECT "accessToken", "refreshToken", scope FROM account WHERE id = $1',
      [id]
    );
    expect(before.rows[0]?.refreshToken).not.toBe(
      "synthetic-workspace-refresh"
    );
    const repeated = await request("/sign-in/social", {
      provider: "google",
      idToken: { token: token(), accessToken: "synthetic-oidc-only" },
    });
    expect(repeated.status).toBe(200);
    const after = await pool.query<
      Pick<
        typeof account.$inferSelect,
        "accessToken" | "refreshToken" | "scope"
      >
    >(
      'SELECT "accessToken", "refreshToken", scope FROM account WHERE id = $1',
      [id]
    );
    expect(after.rows).toEqual(before.rows);
    expect(
      (
        await pool.query("SELECT id FROM public.user WHERE email = $1", [
          profile.email,
        ])
      ).rows
    ).toHaveLength(1);
    const additionalId = randomUUID();
    await pool.query(
      'INSERT INTO account (id, issuer, "accountId", "providerId", "userId", scope, "updatedAt") VALUES ($1, $2, $1, $3, $4, $5, now())',
      [
        additionalId,
        "https://accounts.google.com",
        "google",
        session.user.id,
        "openid email profile",
      ]
    );
    expect(
      await Effect.runPromise(
        readGoogleWorkspaceConnection(scope).pipe(
          Effect.provide(runtimeDatabase)
        )
      )
    ).toEqual({ state: "connected" });
    // Provider revocation is tested at its SDK boundary; OAuth itself above uses signed tokens.
    const { auth: google } = await import("@googleapis/gmail");
    const revoke = vi
      .spyOn(google.OAuth2.prototype, "revokeToken")
      .mockRejectedValue({
        response: { status: 400, data: { error: "invalid_token" } },
      });
    try {
      await Effect.runPromise(
        disconnectGoogleWorkspace(headers).pipe(Effect.provide(runtimeDatabase))
      );
      expect(revoke).toHaveBeenCalledWith("synthetic-workspace-refresh");
    } finally {
      revoke.mockRestore();
    }
    expect(
      await Effect.runPromise(
        readGoogleWorkspaceConnection(scope).pipe(
          Effect.provide(runtimeDatabase)
        )
      )
    ).toEqual({ state: "disconnected" });
    expect(
      (
        await pool.query(
          'SELECT issuer, "accountId", "userId", "accessToken", "refreshToken", scope FROM account WHERE id = $1',
          [id]
        )
      ).rows
    ).toEqual([
      {
        issuer: "https://accounts.google.com",
        accountId: subject,
        userId: session.user.id,
        accessToken: null,
        refreshToken: null,
        scope: "",
      },
    ]);
    const afterDisconnect = await request("/sign-in/social", {
      provider: "google",
      idToken: { token: token() },
    });
    expect(afterDisconnect.status).toBe(200);
    expect(
      (
        await auth.api.getSession({
          headers: new Headers({ cookie: cookie(afterDisconnect) }),
        })
      )?.user.id
    ).toBe(session.user.id);
    await Promise.all(
      [
        {
          sub: randomUUID(),
          email: "outsider@zoen.example.invalid",
          email_verified: true,
        },
        {
          sub: randomUUID(),
          email: "unverified@zoen.example.invalid",
          email_verified: false,
        },
        {
          sub: randomUUID(),
          email: "invited@zoen.example.invalid",
          email_verified: true,
        },
      ].map(async (denied) => {
        const response = await request("/sign-in/social", {
          provider: "google",
          idToken: { token: token("google-signin-proof", denied) },
        });
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(
          (
            await pool.query(
              'SELECT id FROM account WHERE issuer = $1 AND "accountId" = $2',
              ["https://accounts.google.com", denied.sub]
            )
          ).rows
        ).toHaveLength(0);
      })
    );
    const replay = await request(started.path, undefined, started.cookie);
    expect(
      new URL(replay.headers.get("location") ?? "/missing-location", baseURL)
        .pathname
    ).not.toBe("/connections");
  } finally {
    fetch.mockRestore();
    const created = await pool.query<{ id: string }>(
      "SELECT id FROM public.user WHERE email IN ($1, $2, $3) AND name = $4",
      [
        "invited@zoen.example.invalid",
        "outsider@zoen.example.invalid",
        "unverified@zoen.example.invalid",
        "Onboarding proof",
      ]
    );
    for (const row of created.rows) users.add(row.id);
    await Promise.all(
      Array.from(users).map(async (id) => {
        await pool.query("DELETE FROM workspaces WHERE id = $1", [
          accessScopeForUser(`better-auth:${id}`).workspaceId,
        ]);
        await pool.query("DELETE FROM public.user WHERE id = $1", [id]);
      })
    );
    await pool.end();
  }
});
