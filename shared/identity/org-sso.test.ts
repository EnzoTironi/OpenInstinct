import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  assertCanAcceptOrgInvite,
  assertEmailDomainAllowed,
  emailDomain,
  OrgSsoDenied,
  orgSsoFailureMessage,
} from "./org-sso";

describe("C02 org Google SSO invite gates", () => {
  const pendingInvite = {
    id: "inv-1",
    organizationId: "org-acme",
    email: "bob@acme.example",
    role: "member" as const,
    status: "pending" as const,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };

  it("extracts email domains", () => {
    expect(emailDomain("Bob@Acme.Example")).toBe("acme.example");
    expect(emailDomain("not-an-email")).toBeUndefined();
  });

  it("allows any domain when allowlist is empty", async () => {
    await expect(
      Effect.runPromise(assertEmailDomainAllowed("bob@acme.example", []))
    ).resolves.toBeUndefined();
  });

  it("fails closed on domain allowlist miss", async () => {
    const denied = await Effect.runPromise(
      assertEmailDomainAllowed("bob@other.example", ["acme.example"]).pipe(
        Effect.flip
      )
    );
    expect(denied).toEqual(
      new OrgSsoDenied({
        reason: "domain_not_allowed",
        message:
          "Invite email domain is not on the organization Google Workspace allowlist.",
      })
    );
  });

  it("accepts matching verified Google-linked identity", async () => {
    await expect(
      Effect.runPromise(
        assertCanAcceptOrgInvite({
          invite: pendingInvite,
          identity: {
            userId: "user-bob",
            email: "bob@acme.example",
            emailVerified: true,
            hasGoogleAccount: true,
          },
          allowedDomains: ["acme.example"],
        })
      )
    ).resolves.toBeUndefined();
  });

  it("rejects email mismatch, unverified, missing Google, expired", async () => {
    const mismatch = await Effect.runPromise(
      assertCanAcceptOrgInvite({
        invite: pendingInvite,
        identity: {
          userId: "user-bob",
          email: "other@acme.example",
          emailVerified: true,
          hasGoogleAccount: true,
        },
      }).pipe(Effect.flip)
    );
    expect(mismatch.reason).toBe("email_mismatch");

    const unverified = await Effect.runPromise(
      assertCanAcceptOrgInvite({
        invite: pendingInvite,
        identity: {
          userId: "user-bob",
          email: "bob@acme.example",
          emailVerified: false,
          hasGoogleAccount: true,
        },
      }).pipe(Effect.flip)
    );
    expect(unverified.reason).toBe("email_unverified");

    const noGoogle = await Effect.runPromise(
      assertCanAcceptOrgInvite({
        invite: pendingInvite,
        identity: {
          userId: "user-bob",
          email: "bob@acme.example",
          emailVerified: true,
          hasGoogleAccount: false,
        },
      }).pipe(Effect.flip)
    );
    expect(noGoogle.reason).toBe("google_account_missing");
    expect(orgSsoFailureMessage(noGoogle)).toContain("Google");

    const expired = await Effect.runPromise(
      assertCanAcceptOrgInvite({
        invite: {
          ...pendingInvite,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        identity: {
          userId: "user-bob",
          email: "bob@acme.example",
          emailVerified: true,
          hasGoogleAccount: true,
        },
        now: new Date("2026-09-10T00:00:00.000Z"),
      }).pipe(Effect.flip)
    );
    expect(expired.reason).toBe("invite_expired");
  });
});
