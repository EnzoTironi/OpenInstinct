# ADR: C01 minimum company control plane (org + workspace RBAC)

- **Status:** Accepted (minimum viable)
- **Date:** 2026-09-10 (America/Sao_Paulo)
- **Decision:** Extend the existing workspace membership model with an
  optional **organization** parent and `admin` | `member` roles, without
  breaking personal `owner` installs. SSO / audit erasure remain C02.
- **Worker:** C01-RBAC — org/workspace model + authorization gates

## Inventory (verified on `origin/main` @ 01d3148)

| Surface                              | Behavior before C01                                                    | Gap                                                    |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Better Auth (`db/schema/auth.ts`)    | `user` / `session` / `account` / `verification`                        | No org plugin; keep as identity provider only          |
| `workspaces`                         | Id + `created_at` only                                                 | No company parent                                      |
| `workspace_memberships.role`         | CHECK `= 'owner'` only                                                 | No admin/member for shared company workspaces          |
| `accessScopeForUser` / `ensureScope` | Mints `personal:<hash>` + owner membership                             | Must keep working unchanged for personal path          |
| `scopeFromPrincipal`                 | Personal workspace binding only                                        | Company workspace selection is a later product surface |
| Blueprint                            | Private workspaces first; team sharing needs explicit membership/grant | Company control plane missing                          |

## Decision

1. **Organizations** (`organizations`, `organization_memberships`) are the B2B
   control-plane tenant. Roles: `admin` | `member`.
2. **Workspaces** gain nullable `organization_id`:
   - `NULL` → personal workspace (existing install path).
   - set → company workspace under that org.
3. **Workspace roles** widen to `owner` | `admin` | `member`:
   - Personal: **`owner` only** (helpers enforce).
   - Company: **`admin` | `member` only** (helpers enforce; never assign
     `owner` on company workspaces).
4. **Authorization helpers** (`shared/identity/org-rbac.ts`, Effect-safe):
   - Admin/owner may manage members.
   - Member cannot elevate (cannot grant `admin`).
   - Typed `RbacDenied` fails closed.
5. **DB service** (`db/services/organizations.ts`) applies those gates when
   creating company workspaces / setting membership roles. `ensureScope`
   remains the personal provisioning path (`role: "owner"`).
6. **Migration** `0029_org-workspace-rbac` adds tables/column and widens the
   role CHECK with `NOT VALID` + `VALIDATE` (Effect-safe adoption).

## Alternatives considered

- **Better Auth organization plugin as source of truth:** deferred — would
  couple product RBAC to Auth plugin migrations and risk personal-path churn;
  C02 may revisit for SSO.
- **Replace `owner` with `admin` everywhere:** rejected — breaks existing
  personal membership rows and `ensureScope`.
- **Workspace-of-workspaces without `organizations` table:** rejected — need a
  clear company tenant for member management independent of any one workspace.

## Out of scope (follow-ups)

- **C02** SSO audit / erasure, IdP suite, invite emails.
- UI for org switching / invites.
- G02 group shared-memory policy (do not collide; this PR stays on
  auth/org/membership).
- Last-admin resignation locks (helper reason reserved; not enforced yet).

## Consequences

- Existing personal installs keep working: `ensureScope` + `owner` unchanged.
- Company features must call org RBAC gates before mutating memberships.
- Schema tests / drizzle snapshot include org tables; no secrets in tree.
