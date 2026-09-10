import { Effect, Schema } from "effect";

/** Company control-plane roles (org + company workspace). */
const companyRoleSchema = Schema.Literals(["admin", "member"]);
export type CompanyRole = typeof companyRoleSchema.Type;

/** Workspace membership roles including personal `owner`. */
const workspaceRoleSchema = Schema.Literals([
  "owner",
  "admin",
  "member",
]);
export type WorkspaceRole = typeof workspaceRoleSchema.Type;

export class RbacDenied extends Schema.TaggedError<RbacDenied>()("RbacDenied", {
  reason: Schema.Literals([
    "not_admin",
    "cannot_elevate",
    "personal_owner_only",
    "invalid_role",
    "last_admin",
  ]),
  message: Schema.String,
}) {}

/** Personal sole controller or company admin may manage workspace members. */
export function canManageMembers(role: WorkspaceRole | CompanyRole): boolean {
  return role === "owner" || role === "admin";
}

/** Members (and anyone lacking manage rights) cannot grant/change admin. */
export function canAssignRole(
  actorRole: WorkspaceRole | CompanyRole,
  targetRole: WorkspaceRole | CompanyRole
): boolean {
  if (!canManageMembers(actorRole)) return false;
  if (targetRole === "owner") {
    // `owner` is reserved for personal workspaces; company actors never assign it.
    return actorRole === "owner";
  }
  if (targetRole === "admin") {
    return actorRole === "admin" || actorRole === "owner";
  }
  return true;
}

export function assertCanManageMembers(
  actorRole: WorkspaceRole | CompanyRole
): Effect.Effect<void, RbacDenied> {
  return canManageMembers(actorRole)
    ? Effect.void
    : Effect.fail(
        new RbacDenied({
          reason: "not_admin",
          message: "Only an admin (or personal owner) can manage members.",
        })
      );
}

export function assertCanAssignRole(
  actorRole: WorkspaceRole | CompanyRole,
  targetRole: WorkspaceRole | CompanyRole
): Effect.Effect<void, RbacDenied> {
  return Effect.gen(function* () {
    yield* assertCanManageMembers(actorRole);
    if (!canAssignRole(actorRole, targetRole)) {
      yield* Effect.fail(
        new RbacDenied({
          reason: "cannot_elevate",
          message: "Members cannot elevate roles; only admins may grant admin.",
        })
      );
    }
  });
}

/**
 * Personal workspaces must keep a single `owner` membership role.
 * Company workspaces use `admin` | `member` only.
 */
export function assertWorkspaceRoleForKind(
  kind: "personal" | "company",
  role: WorkspaceRole
): Effect.Effect<void, RbacDenied> {
  if (kind === "personal") {
    return role === "owner"
      ? Effect.void
      : Effect.fail(
          new RbacDenied({
            reason: "personal_owner_only",
            message: "Personal workspaces use the owner role only.",
          })
        );
  }
  if (role === "owner") {
    return Effect.fail(
      new RbacDenied({
        reason: "invalid_role",
        message: "Company workspaces use admin or member roles, not owner.",
      })
    );
  }
  return Effect.void;
}

export function rbacFailureMessage(error: RbacDenied): string {
  return error.message;
}
