import { accessScopeForUser } from "@shared/identity/access-scope";
import { describe, expect, it } from "vitest";

describe("accessScopeForUser", () => {
  it("does derive a stable personal workspace id for a user", () => {
    const scope = accessScopeForUser("better-auth:abc");

    expect(scope.userId).toBe("better-auth:abc");
    expect(scope.workspaceId.startsWith("personal:")).toBe(true);
    expect(scope).toEqual(accessScopeForUser("  better-auth:abc  "));
  });

  it("does reject a blank authenticated user id", () => {
    expect(() => accessScopeForUser("   ")).toThrow(
      /authenticated user is required/i
    );
  });
});
