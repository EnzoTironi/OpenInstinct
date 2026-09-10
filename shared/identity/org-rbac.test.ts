import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  assertCanAssignRole,
  assertCanManageMembers,
  assertWorkspaceRoleForKind,
  canAssignRole,
  canManageMembers,
  RbacDenied,
  rbacFailureMessage,
} from "./org-rbac";

describe("C01 org/workspace RBAC", () => {
  it("lets admin and personal owner manage members; member cannot", () => {
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
  });

  it("blocks member elevation to admin", async () => {
    expect(canAssignRole("member", "admin")).toBe(false);
    expect(canAssignRole("admin", "admin")).toBe(true);
    expect(canAssignRole("admin", "member")).toBe(true);
    expect(canAssignRole("member", "member")).toBe(false);

    const denied = await Effect.runPromise(
      assertCanAssignRole("member", "admin").pipe(Effect.flip)
    );
    expect(denied).toEqual(
      new RbacDenied({
        reason: "not_admin",
        message: "Only an admin (or personal owner) can manage members.",
      })
    );
    expect(rbacFailureMessage(denied)).toContain("admin");
  });

  it("fails closed when a non-admin tries to manage members", async () => {
    const denied = await Effect.runPromise(
      assertCanManageMembers("member").pipe(Effect.flip)
    );
    expect(denied.reason).toBe("not_admin");
  });

  it("keeps personal workspaces on owner; company on admin|member", async () => {
    await expect(
      Effect.runPromise(assertWorkspaceRoleForKind("personal", "owner"))
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(
        assertWorkspaceRoleForKind("personal", "admin").pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ reason: "personal_owner_only" });
    await expect(
      Effect.runPromise(assertWorkspaceRoleForKind("company", "admin"))
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(
        assertWorkspaceRoleForKind("company", "owner").pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ reason: "invalid_role" });
  });

  it("never lets company actors assign personal owner", () => {
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("member", "owner")).toBe(false);
  });
});
