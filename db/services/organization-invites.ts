import { db, organizationInvites, organizationMemberships } from "@db";
import {
  assertCanAssignRole,
  assertCanManageMembers,
  type CompanyRole,
  RbacDenied,
} from "@shared/identity/org-rbac";
import {
  assertCanAcceptOrgInvite,
  assertEmailDomainAllowed,
  type GoogleLinkedIdentity,
} from "@shared/identity/org-sso";
import { and, eq } from "drizzle-orm";
import { Clock, Effect, Schema } from "effect";

import { appendOrganizationAuditReceipt } from "./organization-audit";
import { OrganizationMembershipMissing } from "./organizations";

export class OrganizationInviteMissing extends Schema.TaggedError<OrganizationInviteMissing>()(
  "OrganizationInviteMissing",
  { inviteId: Schema.String }
) {}

async function loadOrgMembership(organizationId: string, userId: string) {
  const rows = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId)
      )
    )
    .limit(1);

  return rows[0];
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Org admin invites a Google Workspace identity by email (pending until accept). */
export const createOrganizationInvite = Effect.fn("createOrganizationInvite")(
  function* (input: {
    inviteId: string;
    organizationId: string;
    actorUserId: string;
    email: string;
    role: CompanyRole;
    expiresAt: Date;
    receiptId: string;
    allowedDomains?: readonly string[];
  }) {
    const actor = yield* Effect.promise(() =>
      loadOrgMembership(input.organizationId, input.actorUserId)
    );

    if (actor === undefined) {
      yield* new OrganizationMembershipMissing({
        organizationId: input.organizationId,
        userId: input.actorUserId,
      });

      return { inviteId: input.inviteId };
    }

    yield* assertCanAssignRole(actor.role, input.role);

    const email = normalizeEmail(input.email);
    yield* assertEmailDomainAllowed(email, input.allowedDomains);

    const createdAt = new Date(yield* Clock.currentTimeMillis);
    yield* Effect.tryPromise({
      try: () =>
        db.insert(organizationInvites).values({
          id: input.inviteId,
          organizationId: input.organizationId,
          email,
          role: input.role,
          invitedByUserId: input.actorUserId,
          status: "pending",
          expiresAt: input.expiresAt,
          createdAt,
        }),
      catch: () =>
        new RbacDenied({
          reason: "invalid_role",
          message: "Failed to create organization invite.",
        }),
    });

    yield* appendOrganizationAuditReceipt({
      id: input.receiptId,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "invite_created",
      targetEmail: email,
      metadata: { inviteId: input.inviteId, role: input.role },
      createdAt,
    });

    return { inviteId: input.inviteId };
  }
);

/** Accept a pending invite with a Google-linked Better Auth identity. */
export const acceptOrganizationInvite = Effect.fn("acceptOrganizationInvite")(
  function* (input: {
    inviteId: string;
    identity: GoogleLinkedIdentity;
    receiptId: string;
    now?: Date;
    allowedDomains?: readonly string[];
  }) {
    const invite = yield* Effect.promise(async () => {
      const rows = await db
        .select()
        .from(organizationInvites)
        .where(eq(organizationInvites.id, input.inviteId))
        .limit(1);

      return rows[0];
    });

    if (invite === undefined) {
      yield* new OrganizationInviteMissing({ inviteId: input.inviteId });

      return { organizationId: "", role: "member" as const };
    }

    yield* assertCanAcceptOrgInvite({
      invite: {
        id: invite.id,
        organizationId: invite.organizationId,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
      },
      identity: input.identity,
      now: input.now,
      allowedDomains: input.allowedDomains,
    });

    const createdAt = input.now ?? new Date(yield* Clock.currentTimeMillis);
    yield* Effect.tryPromise({
      try: () =>
        db.transaction(async (tx) => {
          await tx
            .update(organizationInvites)
            .set({
              status: "accepted",
              acceptedUserId: input.identity.userId,
            })
            .where(eq(organizationInvites.id, input.inviteId));
          await tx
            .insert(organizationMemberships)
            .values({
              organizationId: invite.organizationId,
              userId: input.identity.userId,
              role: invite.role,
              createdAt,
            })
            .onConflictDoUpdate({
              target: [
                organizationMemberships.organizationId,
                organizationMemberships.userId,
              ],
              set: { role: invite.role },
            });
        }),
      catch: () =>
        new RbacDenied({
          reason: "invalid_role",
          message: "Failed to accept organization invite.",
        }),
    });

    yield* appendOrganizationAuditReceipt({
      id: input.receiptId,
      organizationId: invite.organizationId,
      actorUserId: input.identity.userId,
      action: "invite_accepted",
      targetUserId: input.identity.userId,
      targetEmail: invite.email,
      metadata: { inviteId: input.inviteId, role: invite.role },
      createdAt,
    });

    return { organizationId: invite.organizationId, role: invite.role };
  }
);

/** Org admin removes a member and writes an append-only receipt. */
export const removeOrganizationMember = Effect.fn("removeOrganizationMember")(
  function* (input: {
    organizationId: string;
    actorUserId: string;
    targetUserId: string;
    receiptId: string;
  }) {
    const actor = yield* Effect.promise(() =>
      loadOrgMembership(input.organizationId, input.actorUserId)
    );

    if (actor === undefined) {
      yield* new OrganizationMembershipMissing({
        organizationId: input.organizationId,
        userId: input.actorUserId,
      });

      return;
    }

    yield* assertCanManageMembers(actor.role);

    const createdAt = new Date(yield* Clock.currentTimeMillis);
    yield* Effect.tryPromise({
      try: () =>
        db
          .delete(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, input.organizationId),
              eq(organizationMemberships.userId, input.targetUserId)
            )
          ),
      catch: () =>
        new RbacDenied({
          reason: "invalid_role",
          message: "Failed to remove organization member.",
        }),
    });

    yield* appendOrganizationAuditReceipt({
      id: input.receiptId,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "member_removed",
      targetUserId: input.targetUserId,
      metadata: {},
      createdAt,
    });
  }
);

/**
 * Role change with audit receipt (wraps membership upsert semantics).
 */
export const setOrganizationMemberRoleAudited = Effect.fn(
  "setOrganizationMemberRoleAudited"
)(function* (input: {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  role: CompanyRole;
  receiptId: string;
}) {
  const { setOrganizationMemberRole } = yield* Effect.promise(
    () => import("./organizations")
  );

  yield* setOrganizationMemberRole({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    role: input.role,
  });
  yield* appendOrganizationAuditReceipt({
    id: input.receiptId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "member_role_changed",
    targetUserId: input.targetUserId,
    metadata: { role: input.role },
  });
});

/** Org admin revokes a pending invite and writes an append-only receipt. */
export const revokeOrganizationInvite = Effect.fn("revokeOrganizationInvite")(
  function* (input: {
    inviteId: string;
    organizationId: string;
    actorUserId: string;
    receiptId: string;
  }) {
    const actor = yield* Effect.promise(() =>
      loadOrgMembership(input.organizationId, input.actorUserId)
    );

    if (actor === undefined) {
      yield* new OrganizationMembershipMissing({
        organizationId: input.organizationId,
        userId: input.actorUserId,
      });

      return;
    }

    yield* assertCanManageMembers(actor.role);

    const invite = yield* Effect.promise(async () => {
      const rows = await db
        .select()
        .from(organizationInvites)
        .where(eq(organizationInvites.id, input.inviteId))
        .limit(1);

      return rows[0];
    });

    if (
      invite === undefined ||
      invite.organizationId !== input.organizationId
    ) {
      yield* new OrganizationInviteMissing({ inviteId: input.inviteId });

      return;
    }

    const createdAt = new Date(yield* Clock.currentTimeMillis);
    yield* Effect.tryPromise({
      try: () =>
        db
          .update(organizationInvites)
          .set({ status: "revoked" })
          .where(eq(organizationInvites.id, input.inviteId)),
      catch: () =>
        new RbacDenied({
          reason: "invalid_role",
          message: "Failed to revoke organization invite.",
        }),
    });

    yield* appendOrganizationAuditReceipt({
      id: input.receiptId,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "invite_revoked",
      targetEmail: invite.email,
      metadata: { inviteId: input.inviteId },
      createdAt,
    });
  }
);
