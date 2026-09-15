import { randomUUID } from "node:crypto";

import { Schema } from "effect";

export const ObjectId = Schema.String.pipe(Schema.brand("ObjectId"));
export type ObjectId = typeof ObjectId.Type;

export const ObjectTypeId = Schema.String.pipe(Schema.brand("ObjectTypeId"));
export type ObjectTypeId = typeof ObjectTypeId.Type;

export const LinkTypeId = Schema.String.pipe(Schema.brand("LinkTypeId"));
export type LinkTypeId = typeof LinkTypeId.Type;

export const ActionTypeId = Schema.String.pipe(Schema.brand("ActionTypeId"));
export type ActionTypeId = typeof ActionTypeId.Type;

export const EntityTypology = Schema.Literals([
  "master",
  "transaction",
  "observation",
  "reference",
]);
export type EntityTypology = typeof EntityTypology.Type;

export const DataClassification = Schema.Literals([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
export type DataClassification = typeof DataClassification.Type;

export const FreshnessBudget = Schema.Struct({
  maxStalenessMs: Schema.Number,
  onStale: Schema.Literals(["reject", "warn", "escalate_to_human"]),
});
export type FreshnessBudget = typeof FreshnessBudget.Type;

export const Provenance = Schema.Struct({
  sourceSystem: Schema.String,
  sourceRecordId: Schema.optionalKey(Schema.String),
  ingestedAt: Schema.Number,
  recordedAt: Schema.Number,
  confidence: Schema.optionalKey(Schema.Number),
  propertyTimestamps: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Number)
  ),
});
export type Provenance = typeof Provenance.Type;

export function generatePrefixedId(
  prefix: string,
  timestampMs: number = Date.now()
): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 6);
  return `${prefix}_${timestampMs}_${suffix}`;
}
