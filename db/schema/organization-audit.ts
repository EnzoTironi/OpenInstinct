import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/** Owner-typed audit metadata (no unknown dictionary escape hatch). */
export interface OrganizationAuditMetadata {
  inviteId?: string;
  role?: string;
  retentionHold?: boolean;
  reason?: string;
  notErased?: readonly string[];
  removedSessions?: number;
  removedJobs?: number;
  cancelledOutbox?: number;
  revokedGrants?: number;
  canceledTasks?: number;
}

/**
 * Append-only receipts for sensitive org admin actions.
 * Application code must INSERT only — never UPDATE or DELETE rows.
 */
export const organizationAuditReceipts = pgTable(
  "organization_audit_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action", {
      enum: [
        "invite_created",
        "invite_accepted",
        "invite_revoked",
        "member_role_changed",
        "member_removed",
        "org_erasure_requested",
        "org_erasure_denied",
      ],
    }).notNull(),
    targetUserId: text("target_user_id"),
    targetEmail: text("target_email"),
    metadata: jsonb("metadata").$type<OrganizationAuditMetadata>().notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "organization_audit_receipts_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    check(
      "organization_audit_receipts_action_check",
      sql`${table.action} IN (
        'invite_created',
        'invite_accepted',
        'invite_revoked',
        'member_role_changed',
        'member_removed',
        'org_erasure_requested',
        'org_erasure_denied'
      )`
    ),
    index("organization_audit_receipts_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
  ]
);

export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    invitedByUserId: text("invited_by_user_id").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "revoked", "expired"],
    }).notNull(),
    acceptedUserId: text("accepted_user_id"),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "organization_invites_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    check(
      "organization_invites_role_check",
      sql`${table.role} IN ('admin', 'member')`
    ),
    check(
      "organization_invites_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'revoked', 'expired')`
    ),
    index("organization_invites_org_email_idx").on(
      table.organizationId,
      table.email
    ),
  ]
);

export const organizationAuditReceiptsRelations = relations(
  organizationAuditReceipts,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationAuditReceipts.organizationId],
      references: [organizations.id],
    }),
  })
);

export const organizationInvitesRelations = relations(
  organizationInvites,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationInvites.organizationId],
      references: [organizations.id],
    }),
  })
);
