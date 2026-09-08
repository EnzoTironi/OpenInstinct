import { Effect } from "effect";
import { symmetricEncodeJWT } from "better-auth/crypto";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { describe, expect, it } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { googleWorkspaceScopes } from "@shared/google-workspace/connection";
import {
  readGoogleWorkspaceChallenge,
  validateGoogleCallback,
} from "./challenge";
import { googleWorkspaceUserId, hasGoogleWorkspaceScopes } from "./index";

const callback =
  "https://example.com/eve/v1/connections/google-workspace/callback/attempt/token";

describe("native Google authorization boundary", () => {
  it("rejects an expired encrypted handoff", async () => {
    const flow = await symmetricEncodeJWT(
      { userId: "alice", callbackURL: callback },
      (await getInstallationSecrets()).betterAuthSecret,
      "companion-google-workspace-link",
      -600
    );
    await expect(
      Effect.runPromise(readGoogleWorkspaceChallenge(flow, "alice"))
    ).rejects.toMatchObject({ reason: "invalid_callback" });
  });
  it("binds the encrypted challenge to the signed-in user", async () => {
    const flow = await symmetricEncodeJWT(
      { userId: "alice", callbackURL: callback },
      (await getInstallationSecrets()).betterAuthSecret,
      "companion-google-workspace-link",
      600
    );
    expect(flow).not.toContain("alice");
    expect(
      await Effect.runPromise(readGoogleWorkspaceChallenge(flow, "alice"))
    ).toBe(callback);
    await expect(
      Effect.runPromise(readGoogleWorkspaceChallenge(flow, "bob"))
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    await expect(
      Effect.runPromise(readGoogleWorkspaceChallenge(`${flow}x`, "alice"))
    ).rejects.toMatchObject({ reason: "invalid_callback" });
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
