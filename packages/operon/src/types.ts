import { randomUUID } from "node:crypto";

import { Schema } from "effect";

export const objectIdSchema = Schema.String.pipe(Schema.brand("ObjectId"));
export type ObjectId = typeof objectIdSchema.Type;

export const objectTypeIdSchema = Schema.String.pipe(
  Schema.brand("ObjectTypeId")
);
export type ObjectTypeId = typeof objectTypeIdSchema.Type;

export const linkTypeIdSchema = Schema.String.pipe(Schema.brand("LinkTypeId"));
export type LinkTypeId = typeof linkTypeIdSchema.Type;

export const actionTypeIdSchema = Schema.String.pipe(
  Schema.brand("ActionTypeId")
);
export type ActionTypeId = typeof actionTypeIdSchema.Type;

export const entityTypologySchema = Schema.Literals([
  "master",
  "transaction",
  "observation",
  "reference",
]);
export type EntityTypology = typeof entityTypologySchema.Type;

export const dataClassificationSchema = Schema.Literals([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
export type DataClassification = typeof dataClassificationSchema.Type;

export const freshnessBudgetSchema = Schema.Struct({
  maxStalenessMs: Schema.Number,
  onStale: Schema.Literals(["reject", "warn", "escalate_to_human"]),
});
export type FreshnessBudget = typeof freshnessBudgetSchema.Type;

export const provenanceSchema = Schema.Struct({
  sourceSystem: Schema.String,
  sourceRecordId: Schema.optionalKey(Schema.String),
  ingestedAt: Schema.Number,
  recordedAt: Schema.Number,
  confidence: Schema.optionalKey(Schema.Number),
  propertyTimestamps: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Number)
  ),
});
export type Provenance = typeof provenanceSchema.Type;

export function generatePrefixedId(
  prefix: string,
  timestampMs: number = Date.now()
): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 6);
  return `${prefix}_${String(timestampMs)}_${suffix}`;
}
