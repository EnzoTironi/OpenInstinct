import { describe, expect, it } from "vitest";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { accessScopeForUser } from "@shared/identity/access-scope";

describe("principal scope", () => {
  it("accepts the workspace derived from the authenticated user", () => {
    const scope = accessScopeForUser("better-auth:user-1");
    expect(
      scopeFromPrincipal({
        attributes: { workspaceId: scope.workspaceId },
        authenticator: "authjs",
        principalId: scope.userId,
        principalType: "user",
      })
    ).toEqual(scope);
  });

  it("rejects a workspace attribute that belongs to another user", () => {
    const victim = accessScopeForUser("better-auth:victim");
    expect(() =>
      scopeFromPrincipal({
        attributes: { workspaceId: victim.workspaceId },
        authenticator: "authjs",
        principalId: "better-auth:attacker",
        principalType: "user",
      })
    ).toThrow("does not belong to the authenticated user");
  });

  it("rejects a foreign workspace regardless of the principal ID prefix", () => {
    const victim = accessScopeForUser("better-auth:victim");
    expect(() =>
      scopeFromPrincipal({
        attributes: { workspaceId: victim.workspaceId },
        authenticator: "telegram",
        principalId: "telegram:attacker",
        principalType: "user",
      })
    ).toThrow("does not belong to the authenticated user");
  });

  it("accepts a channel-neutral principal with its own workspace", () => {
    const scope = accessScopeForUser("telegram:user-1");
    expect(
      scopeFromPrincipal({
        attributes: { workspaceId: scope.workspaceId },
        authenticator: "telegram",
        principalId: scope.userId,
        principalType: "user",
      })
    ).toEqual(scope);
  });

  it("rejects ambiguous principal aliases", () => {
    const scope = accessScopeForUser("better-auth:alice");
    const principal = {
      attributes: { workspaceId: scope.workspaceId },
      authenticator: "authjs",
      principalType: "user" as const,
      principalId: "better-auth:bob",
      id: scope.userId,
    };
    expect(() => scopeFromPrincipal(principal)).toThrow("unambiguous");
  });

  it.each(["", " ", " better-auth:alice", "better-auth:alice "])(
    "rejects a noncanonical principal ID %j",
    (principalId) => {
      const scope = accessScopeForUser("better-auth:alice");
      expect(() =>
        scopeFromPrincipal({
          attributes: { workspaceId: scope.workspaceId },
          authenticator: "authjs",
          principalType: "user",
          principalId,
        })
      ).toThrow("authenticated workspace user");
    }
  );

  it("accepts the framework connection principal shape", () => {
    const scope = accessScopeForUser("better-auth:alice");
    expect(
      scopeFromPrincipal({
        type: "user",
        id: scope.userId,
        attributes: { workspaceId: scope.workspaceId },
      })
    ).toEqual(scope);
  });
});
