import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * B2B organization (company control plane). Personal workspaces keep
 * `workspaces.organization_id` NULL and do not require an org row.
 */
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    precision: 3,
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.userId],
      name: "organization_memberships_pkey",
    }),
    foreignKey({
      name: "organization_memberships_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    check(
      "organization_memberships_role_check",
      sql`${table.role} IN ('admin', 'member')`
    ),
    index("organization_memberships_user_idx").on(table.userId),
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(organizationMemberships),
}));

export const organizationMembershipsRelations = relations(
  organizationMemberships,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMemberships.organizationId],
      references: [organizations.id],
    }),
  })
);
