# ADR: C02 Google Workspace SSO invite path + org audit + erasure gates

- **Status:** Accepted (minimum viable)
- **Date:** 2026-09-10 (America/Sao_Paulo)
- **Decision:** Keep Better Auth Google as the **identity** provider; keep C01
  `organizations` / `organization_memberships` as the **company membership**
  source of truth. Ship an invite acceptance path usable for org members,
  append-only audit receipts for sensitive org admin actions, and Effect-safe
  **fail-closed** org erasure/retention gates beyond personal online wipe.
- **Worker:** C02-SSO — SSO/invite + audit receipts + erasure policy gates

## Inventory (verified on `origin/main` @ a30730b after C01 merge)

| Surface                                                                         | Behavior before C02                                                                                                                                                | Gap                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Better Auth (`db/services/auth/index.ts`)                                       | Google social provider when `GOOGLE_CLIENT_*` set; `disableSignUp: true`; many public email/social sign-in paths disabled; channel-auth plugin for messenger login | Not an org IdP suite; no Better Auth organization plugin                               |
| Google Workspace connect (`server/google-workspace`, `shared/google-workspace`) | OAuth for Gmail/Calendar/Contacts scopes on a personal connection                                                                                                  | Product OAuth ≠ company SSO membership                                                 |
| C01 org RBAC (`shared/identity/org-rbac.ts`, `db/services/organizations.ts`)    | Org + company workspace roles; `setOrganizationMemberRole`                                                                                                         | No invite email path; no remove+receipt; no audit table                                |
| Personal privacy (`server/accounts/privacy.ts`)                                 | Online personal-memory wipe + browser session invalidation; documented exclusions                                                                                  | Explicitly does **not** erase org memberships, company workspaces, invites, or backups |

## Decision

1. **SSO / invite path (product-owned):**
   - Org admin creates `organization_invites` rows (email + `admin`\|`member`).
   - Accept requires a Better Auth user with **verified email matching the invite**
     and a **linked Google account** (`hasGoogleAccount`). Optional hosted-domain
     allowlist fails closed when configured (`assertEmailDomainAllowed`).
   - Helpers live in `shared/identity/org-sso.ts`; persistence in
     `db/services/organization-invites.ts`.
2. **Audit receipts (append-only):**
   - Table `organization_audit_receipts` + `appendOrganizationAuditReceipt`.
   - Actions covered: invite create/accept/revoke, member role change/remove,
     org erasure request/denial.
   - Application code **INSERT only** — never UPDATE/DELETE receipts. FK to
     organizations uses `ON DELETE restrict` so receipts outlive casual org
     row deletion attempts.
3. **Erasure / retention beyond personal wipe:**
   - Documented in `shared/identity/org-erasure.ts` + this ADR.
   - `requestOrganizationErasure` always **denies cascade** today
     (`cascade_unimplemented` or `retention_hold` / `not_admin`) and writes
     request + denial receipts. No claim of full org delete.
   - Personal wipe remains limited to personal memory + sessions (C01/privacy).
4. **Migration** `0030_org-sso-audit-erasure` adds invite + audit tables with
   `NOT VALID` + `VALIDATE` checks (Effect-safe adoption).

## Alternatives considered

- **Adopt Better Auth organization plugin as SoT:** deferred — would couple
  product RBAC/migrations to Auth plugin and risk personal-path churn (same
  rejection as C01). Revisit only if IdP suite requirements force it.
- **Treat Google Workspace OAuth connect as SSO membership:** rejected —
  that flow is a personal integration connection with Gmail scopes, not an
  org control-plane grant.
- **Implement full org cascade delete now:** rejected for min viable — too
  easy to over-claim; fail-closed stub + ADR is the honest gate.

## Out of scope (follow-ups)

- Invite email delivery / magic links UI.
- Last-admin resignation locks (C01 reserved reason).
- Full multi-table org cascade wipe + backup reconciliation.
- Better Auth organization plugin / SCIM / SAML IdP suite.
- G03 channel/group files (do not collide).

## Consequences

- Company invites are usable once a Google-linked identity matches the invite.
- Sensitive org admin mutations can leave durable receipts for review/export.
- Callers must not advertise complete org erasure; gates fail closed.
- No secrets in tree; Google client credentials stay env-only.
