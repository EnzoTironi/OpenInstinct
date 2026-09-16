import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { workspaceMemberships } from "./workspaces";

const recordedAt = () =>
  timestamp("recorded_at", {
    mode: "date",
    precision: 3,
    withTimezone: true,
  }).notNull();

export const operonSources = pgTable(
  "operon_source",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerRevision: text("provider_revision").notNull(),
    metadata: jsonb("metadata").notNull(),
    observedAt: timestamp("observed_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull(),
    recordedAt: recordedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.id] }),
    foreignKey({
      name: "operon_source_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    unique("operon_source_provider_uidx").on(
      table.workspaceId,
      table.userId,
      table.providerId,
      table.providerRevision
    ),
    index("operon_source_scope_recorded_idx").on(
      table.workspaceId,
      table.userId,
      table.recordedAt.desc()
    ),
    check(
      "operon_source_scope_check",
      sql`length(trim(${table.userId})) > 0 AND length(trim(${table.workspaceId})) > 0`
    ),
  ]
);

export const operonClaims = pgTable(
  "operon_claim",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    sourceId: text("source_id").notNull(),
    subjectId: text("subject_id").notNull(),
    predicate: text("predicate").notNull(),
    value: jsonb("value").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    recordedAt: recordedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.id] }),
    foreignKey({
      name: "operon_claim_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "operon_claim_source_fkey",
      columns: [table.workspaceId, table.userId, table.sourceId],
      foreignColumns: [
        operonSources.workspaceId,
        operonSources.userId,
        operonSources.id,
      ],
    }).onDelete("cascade"),
    index("operon_claim_subject_idx").on(
      table.workspaceId,
      table.userId,
      table.subjectId
    ),
    check(
      "operon_claim_kind_check",
      sql`${table.kind} IN ('interpretation', 'provider_metadata')`
    ),
    check(
      "operon_claim_state_check",
      sql`${table.state} IN ('accepted', 'proposed', 'separated', 'superseded')`
    ),
  ]
);

export const operonObjects = pgTable(
  "operon_object",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    typeId: text("type_id").notNull(),
    revision: text("revision").notNull(),
    body: jsonb("body").notNull(),
    operationalStatus: text("operational_status"),
    recordedAt: recordedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.id] }),
    foreignKey({
      name: "operon_object_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("operon_object_type_idx").on(
      table.workspaceId,
      table.userId,
      table.typeId
    ),
  ]
);

export const operonObjectRevisions = pgTable(
  "operon_object_revision",
  {
    objectId: text("object_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    revision: text("revision").notNull(),
    typeId: text("type_id").notNull(),
    body: jsonb("body").notNull(),
    operationalStatus: text("operational_status"),
    recordedAt: recordedAt(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.userId,
        table.objectId,
        table.revision,
      ],
    }),
    foreignKey({
      name: "operon_object_revision_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "operon_object_revision_object_fkey",
      columns: [table.workspaceId, table.userId, table.objectId],
      foreignColumns: [
        operonObjects.workspaceId,
        operonObjects.userId,
        operonObjects.id,
      ],
    }).onDelete("cascade"),
  ]
);

export const operonContactIdentities = pgTable(
  "operon_contact_identity",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    handle: text("handle").notNull(),
    personId: text("person_id").notNull(),
    recordedAt: recordedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.id] }),
    foreignKey({
      name: "operon_contact_identity_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    unique("operon_contact_identity_handle_uidx").on(
      table.workspaceId,
      table.userId,
      table.handle
    ),
    index("operon_contact_identity_person_idx").on(
      table.workspaceId,
      table.userId,
      table.personId
    ),
  ]
);

export const operonIdentityMerges = pgTable(
  "operon_identity_merge",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    leftIdentityId: text("left_identity_id").notNull(),
    leftPersonId: text("left_person_id").notNull(),
    rightIdentityId: text("right_identity_id").notNull(),
    rightPersonId: text("right_person_id").notNull(),
    evidenceSourceId: text("evidence_source_id").notNull(),
    status: text("status").notNull(),
    recordedAt: recordedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.id] }),
    foreignKey({
      name: "operon_identity_merge_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "operon_identity_merge_evidence_fkey",
      columns: [table.workspaceId, table.userId, table.evidenceSourceId],
      foreignColumns: [
        operonSources.workspaceId,
        operonSources.userId,
        operonSources.id,
      ],
    }).onDelete("restrict"),
    check(
      "operon_identity_merge_status_check",
      sql`${table.status} IN ('accepted', 'proposed', 'separated')`
    ),
  ]
);
