import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { vaultItemKinds } from "@shared/vault/schema";
import { workspaces } from "./workspaces";

export const vaultItems = pgTable(
  "vault_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind", { enum: vaultItemKinds }).notNull(),
    label: text("label").notNull(),
    account: text("account").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "vault_items_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "vault_items_kind_check",
      sql`${table.kind} IN ('login', 'payment', 'address', 'contact', 'phone', 'identity', 'token')`
    ),
    index("vault_items_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt.desc().nullsFirst()
    ),
  ]
);

export const encryptedSecrets = pgTable(
  "encrypted_secrets",
  {
    workspaceId: text("workspace_id").notNull(),
    namespace: text("namespace", { enum: ["vault"] }).notNull(),
    id: text("id").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.namespace, table.id],
      name: "encrypted_secrets_pkey",
    }),
    foreignKey({
      name: "encrypted_secrets_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "encrypted_secrets_namespace_check",
      sql`${table.namespace} = 'vault'`
    ),
  ]
);

export const vaultAgentIdentities = pgTable(
  "vault_agent_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    wrappingKey: text("wrapping_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("vault_agent_identities_workspace_uidx")
      .on(table.workspaceId)
      .where(sql`${table.revokedAt} IS NULL`),
  ]
);

export const vaultItemDelegations = pgTable(
  "vault_item_delegations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => vaultAgentIdentities.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    wrappedSecret: text("wrapped_secret").notNull(),
    issuedBy: text("issued_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "vault_item_delegations_item_id_fkey",
      columns: [table.itemId],
      foreignColumns: [vaultItems.id],
    }).onDelete("cascade"),
    uniqueIndex("vault_item_delegations_live_uidx")
      .on(table.identityId, table.itemId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("vault_item_delegations_workspace_idx").on(table.workspaceId),
  ]
);

export const vaultItemsRelations = relations(vaultItems, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [vaultItems.workspaceId],
    references: [workspaces.id],
  }),
}));

export const encryptedSecretsRelations = relations(
  encryptedSecrets,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [encryptedSecrets.workspaceId],
      references: [workspaces.id],
    }),
  })
);
