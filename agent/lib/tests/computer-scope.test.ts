import { describe, expect, it } from "vitest";
import { computerScopeFromPrincipal } from "../computer-scope";
import { computerScopeKey } from "../../../server/operon-kernel";
import { accessScopeForUser } from "@shared/identity/access-scope";

describe("computer scope from principal", () => {
  it("does bind a private user to their workspace, not a coworker", () => {
    const alice = accessScopeForUser("better-auth:alice");
    const bob = accessScopeForUser("better-auth:bob");
    const scope = computerScopeFromPrincipal({
      attributes: { workspaceId: alice.workspaceId },
      authenticator: "authjs",
      principalId: alice.userId,
      principalType: "user",
    });
    expect(scope).toEqual({
      kind: "private",
      userId: alice.userId,
      workspaceId: alice.workspaceId,
    });
    expect(computerScopeKey(scope)).not.toBe(
      computerScopeKey({
        kind: "private",
        userId: bob.userId,
        workspaceId: alice.workspaceId,
      })
    );
  });

  it("does key shared work by audience rather than workspace id", () => {
    const shared = computerScopeFromPrincipal({
      attributes: {
        chatKind: "group",
        conversationId: "telegram:-100",
        groupBindingId: "binding:acme",
        workspaceId: "company:acme",
        workspaceKind: "company",
      },
      authenticator: "verified-channel",
      principalId: "better-auth:alice",
      principalType: "user",
    });
    expect(shared).toEqual({
      kind: "shared",
      audienceId: "binding:acme",
      workspaceId: "company:acme",
    });
    expect(computerScopeKey(shared)).not.toBe(
      computerScopeKey({
        kind: "private",
        userId: "better-auth:alice",
        workspaceId: "company:acme",
      })
    );
    expect(() =>
      computerScopeFromPrincipal({
        attributes: {
          chatKind: "group",
          workspaceId: "company:acme",
        },
        authenticator: "verified-channel",
        principalId: "better-auth:alice",
        principalType: "user",
      })
    ).toThrow("destinatário");
  });
});
