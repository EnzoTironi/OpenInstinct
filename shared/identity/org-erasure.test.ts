import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  assertOrgErasureAllowed,
  OrgErasureDenied,
  orgErasureFailureMessage,
  orgErasureSurfaces,
  type OrgErasureSurface,
  orgRetentionPolicy,
} from "./org-erasure";

describe("C02 org erasure / retention gates", () => {
  it("documents retention beyond personal wipe", () => {
    expect(orgRetentionPolicy.personalOnlineWipeScope).toContain("personal");
    expect(orgRetentionPolicy.auditReceipts).toBe("retain_append_only");
    expect(orgErasureSurfaces).toContain("organization_memberships");
    expect(orgErasureSurfaces).toContain("organization_audit_receipts");
    const surface: OrgErasureSurface = "backups";
    expect(orgErasureSurfaces).toContain(surface);
    expect(
      new OrgErasureDenied({
        reason: "audit_required",
        message: "need receipt",
      }).reason
    ).toBe("audit_required");
  });

  it("denies non-admin erase requests", async () => {
    const decision = await Effect.runPromise(
      assertOrgErasureAllowed({
        organizationId: "org-acme",
        actorUserId: "bob",
        actorRole: "member",
      })
    );

    expect(decision.status).toBe("denied");
    expect(decision.reason).toBe("not_admin");
  });

  it("denies cascade even for admins (fail closed stub)", async () => {
    const decision = await Effect.runPromise(
      assertOrgErasureAllowed({
        organizationId: "org-acme",
        actorUserId: "alice",
        actorRole: "admin",
      })
    );

    expect(decision.status).toBe("denied");
    expect(decision.reason).toBe("cascade_unimplemented");
    expect(decision.notErased).toEqual(orgErasureSurfaces);
    expect(orgErasureFailureMessage(decision)).toContain("not implemented");
  });

  it("honors retention holds ahead of cascade stub", async () => {
    const decision = await Effect.runPromise(
      assertOrgErasureAllowed({
        organizationId: "org-acme",
        actorUserId: "alice",
        actorRole: "admin",
        retentionHold: true,
      })
    );

    expect(decision.reason).toBe("retention_hold");
  });
});
