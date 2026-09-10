import { Effect, Schema } from "effect";
import { canManageMembers, type CompanyRole } from "./org-rbac";

/**
 * Org-scoped erasure / retention gates beyond personal online wipe (C02).
 *
 * Full cascade deletion of company workspaces, memberships, invites, and
 * related tenant data is **not** implemented here. Gates fail closed and
 * record policy outcomes so callers cannot claim a complete erase succeeded.
 */

export class OrgErasureDenied extends Schema.TaggedError<OrgErasureDenied>()(
  "OrgErasureDenied",
  {
    reason: Schema.Literals([
      "not_admin",
      "cascade_unimplemented",
      "retention_hold",
      "audit_required",
    ]),
    message: Schema.String,
  }
) {}

/** Surfaces that org erase must eventually cover (documented retention map). */
export const orgErasureSurfaces = [
  "organization_memberships",
  "organization_invites",
  "company_workspaces",
  "workspace_memberships",
  "organization_audit_receipts",
  "connected_google_workspace",
  "schedules",
  "artifacts",
  "conversation-history",
  "backups",
] as const;

export type OrgErasureSurface = (typeof orgErasureSurfaces)[number];

/**
 * Retention: audit receipts are retained even when membership rows are removed.
 * Personal online wipe (`server/accounts/privacy.ts`) does not erase org data.
 */
export const orgRetentionPolicy = {
  auditReceipts: "retain_append_only",
  memberships: "delete_on_approved_erase",
  invites: "delete_on_approved_erase",
  companyWorkspaces: "block_until_cascade_implemented",
  backups: "out_of_band_retention",
  personalOnlineWipeScope: "personal_memory_and_browser_sessions_only",
} as const;

export type OrgErasureRequest = {
  organizationId: string;
  actorUserId: string;
  actorRole: CompanyRole;
  /** When true, refuse erase because a legal/compliance hold is active. */
  retentionHold?: boolean;
};

export type OrgErasureDecision = {
  status: "denied";
  reason: OrgErasureDenied["reason"];
  notErased: readonly OrgErasureSurface[];
  limits: string;
};

/**
 * Fail-closed org erase gate. Always denies cascade until a future worker
 * implements an audited multi-table wipe; still requires org admin.
 */
export function assertOrgErasureAllowed(
  input: OrgErasureRequest
): Effect.Effect<OrgErasureDecision> {
  return Effect.sync(() => {
    if (!canManageMembers(input.actorRole)) {
      return {
        status: "denied" as const,
        reason: "not_admin" as const,
        notErased: orgErasureSurfaces,
        limits: "Only an organization admin may request org-scoped erasure.",
      };
    }

    if (input.retentionHold) {
      return {
        status: "denied" as const,
        reason: "retention_hold" as const,
        notErased: orgErasureSurfaces,
        limits:
          "Organization erasure is blocked while a retention hold is active. Audit receipts remain append-only.",
      };
    }

    return {
      status: "denied" as const,
      reason: "cascade_unimplemented" as const,
      notErased: orgErasureSurfaces,
      limits:
        "Org-scoped cascade erase is not implemented. Personal online wipe does not delete organization memberships, invites, company workspaces, audit receipts, or backups. Fail closed — do not claim org deletion succeeded.",
    };
  });
}

export function orgErasureFailureMessage(decision: OrgErasureDecision): string {
  return decision.limits;
}
