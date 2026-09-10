import { Effect, Schema } from "effect";
import type { CompanyRole } from "./org-rbac";

/**
 * Google Workspace SSO / invite acceptance rules for C02.
 *
 * Better Auth remains the identity provider (`account.providerId === "google"`).
 * Organization membership stays product-owned (C01 tables) — we do not adopt the
 * Better Auth organization plugin in this slice.
 *
 * Invite path: org admin mints a pending invite for an email; the invitee must
 * present a live Better Auth user whose verified email matches and who has a
 * linked Google account. Domain allowlists are optional policy metadata only.
 */

export class OrgSsoDenied extends Schema.TaggedError<OrgSsoDenied>()(
  "OrgSsoDenied",
  {
    reason: Schema.Literals([
      "email_mismatch",
      "email_unverified",
      "google_account_missing",
      "invite_not_pending",
      "invite_expired",
      "domain_not_allowed",
    ]),
    message: Schema.String,
  }
) {}

export interface GoogleLinkedIdentity {
  userId: string;
  email: string;
  emailVerified: boolean;
  hasGoogleAccount: boolean;
}

export interface OrganizationInviteView {
  id: string;
  organizationId: string;
  email: string;
  role: CompanyRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string | undefined {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return undefined;
  return normalized.slice(at + 1);
}

/** Optional Workspace hosted-domain gate (fail closed when allowlist is set). */
export function assertEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[] | undefined
): Effect.Effect<void, OrgSsoDenied> {
  if (allowedDomains === undefined || allowedDomains.length === 0) {
    return Effect.void;
  }
  const domain = emailDomain(email);
  const allowed = new Set(
    allowedDomains.map((value) => value.trim().toLowerCase()).filter(Boolean)
  );
  if (domain === undefined || !allowed.has(domain)) {
    return Effect.fail(
      new OrgSsoDenied({
        reason: "domain_not_allowed",
        message:
          "Invite email domain is not on the organization Google Workspace allowlist.",
      })
    );
  }
  return Effect.void;
}

/**
 * Gate invite acceptance: verified email match + linked Google account.
 * Does not mint membership — callers persist after this Effect succeeds.
 */
export function assertCanAcceptOrgInvite(input: {
  invite: OrganizationInviteView;
  identity: GoogleLinkedIdentity;
  now?: Date;
  allowedDomains?: readonly string[];
}): Effect.Effect<void, OrgSsoDenied> {
  return Effect.gen(function* () {
    if (input.invite.status !== "pending") {
      yield* Effect.fail(
        new OrgSsoDenied({
          reason: "invite_not_pending",
          message: "Only pending organization invites can be accepted.",
        })
      );
    }

    const now = input.now ?? new Date();
    if (input.invite.expiresAt.getTime() <= now.getTime()) {
      yield* Effect.fail(
        new OrgSsoDenied({
          reason: "invite_expired",
          message: "This organization invite has expired.",
        })
      );
    }

    yield* assertEmailDomainAllowed(input.invite.email, input.allowedDomains);

    if (!input.identity.emailVerified) {
      yield* Effect.fail(
        new OrgSsoDenied({
          reason: "email_unverified",
          message:
            "Verify the Google-linked email before joining the organization.",
        })
      );
    }

    if (
      normalizeEmail(input.identity.email) !==
      normalizeEmail(input.invite.email)
    ) {
      yield* Effect.fail(
        new OrgSsoDenied({
          reason: "email_mismatch",
          message:
            "Signed-in Google email must match the organization invite email.",
        })
      );
    }

    if (!input.identity.hasGoogleAccount) {
      yield* Effect.fail(
        new OrgSsoDenied({
          reason: "google_account_missing",
          message:
            "Link a Google account (Workspace SSO) before accepting an organization invite.",
        })
      );
    }
  });
}

export function orgSsoFailureMessage(error: OrgSsoDenied): string {
  return error.message;
}
