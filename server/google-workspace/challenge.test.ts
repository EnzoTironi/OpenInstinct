import { Effect, Layer, ManagedRuntime } from "effect";
import { symmetricEncodeJWT } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { googleWorkspaceScopes } from "@shared/google-workspace/connection";
import type { SessionAuthContext } from "eve/context";
import { BrowserWorkerAccess } from "../browser-worker";
import { BrowserWorkerAccessError } from "../browser-worker/access";
import {
  createGoogleWorkspaceChallenge,
  readGoogleWorkspaceChallenge,
  validateGoogleCallback,
} from "./challenge";
import {
  googleWorkspaceUserId,
  hasGoogleWorkspaceScopes,
  isInvalidGoogleRevocationToken,
} from "./index";

const callback =
  "https://example.com/eve/v1/connections/google-workspace/callback/attempt/token";

/** Fixture secrets — not live installation material. */
const fixtureSecrets = {
  betterAuthSecret: "test-auth-secret-0123456789abcdefghijklmnop",
  secretEncryptionKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
};

const secretsLayer =
  ResolvedInstallationSecrets.layerFromResolved(fixtureSecrets);

function membershipPrincipal(userId = "better-auth:alice"): SessionAuthContext {
  const scope = accessScopeForUser(userId);
  return {
    attributes: { workspaceId: scope.workspaceId },
    authenticator: "test",
    principalId: scope.userId,
    principalType: "user",
  };
}

function channelPrincipal(): SessionAuthContext {
  const scope = accessScopeForUser("better-auth:alice");
  return {
    attributes: {
      channelIdentityId: "11111111-1111-4111-8111-111111111111",
      conversationChannel: "telegram",
      conversationId: "11111111-1111-4111-8111-111111111111",
      workspaceId: scope.workspaceId,
    },
    authenticator: "verified-channel",
    principalId: scope.userId,
    principalType: "user",
  };
}

function challengeRuntime(
  authorize: (
    principal: SessionAuthContext
  ) => Effect.Effect<
    ReturnType<typeof accessScopeForUser>,
    BrowserWorkerAccessError
  >
) {
  return ManagedRuntime.make(
    Layer.mergeAll(
      secretsLayer,
      Layer.succeed(BrowserWorkerAccess, { authorize })
    )
  );
}

describe("native Google authorization boundary", () => {
  it("rejects an expired encrypted handoff (fixture secrets)", async () => {
    const flow = await symmetricEncodeJWT(
      { userId: "alice", callbackURL: callback },
      fixtureSecrets.betterAuthSecret,
      "companion-google-workspace-link",
      -600
    );
    const runtime = ManagedRuntime.make(secretsLayer);
    await expect(
      runtime.runPromise(readGoogleWorkspaceChallenge(flow, "alice"))
    ).rejects.toMatchObject({ reason: "invalid_callback" });
    await runtime.dispose();
  });

  it("binds the encrypted challenge to the signed-in user (fixture secrets)", async () => {
    const flow = await symmetricEncodeJWT(
      { userId: "alice", callbackURL: callback },
      fixtureSecrets.betterAuthSecret,
      "companion-google-workspace-link",
      600
    );
    expect(flow).not.toContain("alice");
    const runtime = ManagedRuntime.make(secretsLayer);
    expect(
      await runtime.runPromise(readGoogleWorkspaceChallenge(flow, "alice"))
    ).toBe(callback);
    await expect(
      runtime.runPromise(readGoogleWorkspaceChallenge(flow, "bob"))
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    await expect(
      runtime.runPromise(readGoogleWorkspaceChallenge(`${flow}x`, "alice"))
    ).rejects.toMatchObject({ reason: "invalid_callback" });
    await runtime.dispose();
  });

  it.each([
    "https://evil.example/eve/v1/connections/google/callback/attempt/token",
    "https://example.com/api/auth/callback/google",
    "https://example.com/eve/v1/connections/google/callback/attempt/token#fragment",
    "https://user@example.com/eve/v1/connections/google/callback/attempt/token",
  ])("rejects an invalid native callback %s", async (url) => {
    await expect(
      Effect.runPromise(validateGoogleCallback(url, "https://example.com"))
    ).rejects.toMatchObject({ reason: "invalid_callback" });
  });

  it("rejects a foreign workspace and non-Better-Auth principal", async () => {
    await expect(
      Effect.runPromise(
        googleWorkspaceUserId({
          ...accessScopeForUser("better-auth:alice"),
          workspaceId: "foreign",
        })
      )
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    await expect(
      Effect.runPromise(googleWorkspaceUserId(accessScopeForUser("alice")))
    ).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("requires business scopes without depending on identity aliases", () => {
    const business = googleWorkspaceScopes.filter((scope) =>
      scope.startsWith("https://www.googleapis.com/auth/")
    );
    expect(
      hasGoogleWorkspaceScopes(
        [
          ...business,
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile",
          "openid",
        ].join(" ")
      )
    ).toBe(true);
    for (const missing of business)
      expect(
        hasGoogleWorkspaceScopes(
          business.filter((scope) => scope !== missing).join(" ")
        )
      ).toBe(false);
    expect(hasGoogleWorkspaceScopes(null)).toBe(false);
  });
});

describe("Google Workspace live consent authority", () => {
  it("issues a challenge when live delegated authority succeeds (fixture)", async () => {
    const principal = membershipPrincipal();
    const scope = accessScopeForUser(principal.principalId);
    const runtime = challengeRuntime(() => Effect.succeed(scope));
    const href = await runtime.runPromise(
      createGoogleWorkspaceChallenge(principal, callback)
    );
    const url = new URL(href);
    expect(url.pathname).toBe("/api/google-workspace/connect");
    const flow = url.searchParams.get("flow");
    expect(flow).toEqual(expect.any(String));
    if (!flow) throw new Error("expected encrypted flow");
    expect(
      await runtime.runPromise(readGoogleWorkspaceChallenge(flow, "alice"))
    ).toBe(callback);
    await runtime.dispose();
  });

  it("denies challenge issuance after channel revoke even when ownership remains (fixture)", async () => {
    const principal = channelPrincipal();
    const runtime = challengeRuntime(() =>
      Effect.fail(new BrowserWorkerAccessError({ reason: "revoked" }))
    );
    await expect(
      runtime.runPromise(createGoogleWorkspaceChallenge(principal, callback))
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    await runtime.dispose();
  });

  it("denies challenge issuance after schedule pause even when ownership remains (fixture)", async () => {
    const scope = accessScopeForUser("better-auth:alice");
    const principal: SessionAuthContext = {
      attributes: {
        channelIdentityId: "11111111-1111-4111-8111-111111111111",
        conversationChannel: "telegram",
        conversationId: "11111111-1111-4111-8111-111111111111",
        scheduleId: "22222222-2222-4222-8222-222222222222",
        scheduledRunId: "33333333-3333-4333-8333-333333333333",
        scheduledRunLeaseToken: "44444444-4444-4444-8444-444444444444",
        workspaceId: scope.workspaceId,
      },
      authenticator: "scheduled-worker",
      principalId: scope.userId,
      principalType: "user",
    };
    const runtime = challengeRuntime(() =>
      Effect.fail(new BrowserWorkerAccessError({ reason: "paused" }))
    );
    await expect(
      runtime.runPromise(createGoogleWorkspaceChallenge(principal, callback))
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    await runtime.dispose();
  });

  it("fails closed when live authority cannot be verified (fixture)", async () => {
    const runtime = challengeRuntime(() =>
      Effect.fail(new BrowserWorkerAccessError({ reason: "unavailable" }))
    );
    await expect(
      runtime.runPromise(
        createGoogleWorkspaceChallenge(membershipPrincipal(), callback)
      )
    ).rejects.toMatchObject({ reason: "unavailable" });
    await runtime.dispose();
  });
});

describe("Google revocation error classification", () => {
  it("accepts only the explicit invalid-token revocation response", () => {
    expect(
      isInvalidGoogleRevocationToken({
        response: { status: 400, data: { error: "invalid_token" } },
      })
    ).toBe(true);
  });
  it.each([
    null,
    { response: { status: 400 } },
    { response: { status: 400, data: { error: "invalid_request" } } },
    { response: { status: 401, data: { error: "invalid_token" } } },
    { response: { status: 503, data: { error: "invalid_token" } } },
    { response: { status: 400, data: "invalid_token" } },
    { message: "invalid_token", code: "ETIMEDOUT" },
  ])("does not treat other failures as confirmed invalidation: %j", (cause) => {
    expect(isInvalidGoogleRevocationToken(cause)).toBe(false);
  });
});
