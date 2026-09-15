import { Schema } from "effect";

import { dataClassificationSchema, entityTypologySchema } from "./types";

export const effectClassSchema = Schema.Literals([
  "read_only",
  "state_mutation",
  "external_side_effect",
]);
export type EffectClass = typeof effectClassSchema.Type;

export const propertyDefSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["string", "number", "boolean", "date", "json"]),
  required: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
});
export type PropertyDef = typeof propertyDefSchema.Type;

export const typeDefSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  properties: Schema.Record(Schema.String, propertyDefSchema),
  primaryKey: Schema.String,
  typology: Schema.optional(entityTypologySchema),
  classification: Schema.optional(dataClassificationSchema),
});
export type TypeDef = typeof typeDefSchema.Type;

export const linkDefSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  sourceTypeId: Schema.String,
  targetTypeId: Schema.String,
  cardinality: Schema.Literals(["1:1", "1:N", "N:N"]),
  deletionSemantics: Schema.optional(
    Schema.Literals(["cascade", "set_null", "restrict"])
  ),
  temporal: Schema.optional(Schema.Boolean),
});
export type LinkDef = typeof linkDefSchema.Type;

export const queryDefSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  returnTypeId: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.String),
  description: Schema.optional(Schema.String),
});
export type QueryDef = typeof queryDefSchema.Type;

export const actionDefSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  effectClass: effectClassSchema,
  riskTier: Schema.Literals(["low", "moderate", "high", "critical"]),
  parametersSchema: Schema.Record(Schema.String, Schema.String),
  requiredRoles: Schema.Array(Schema.String),
});
export type ActionDef = typeof actionDefSchema.Type;

export const definitionArtifactSchema = Schema.Struct({
  types: Schema.Array(typeDefSchema),
  links: Schema.Array(linkDefSchema),
  queries: Schema.Array(queryDefSchema),
  actions: Schema.Array(actionDefSchema),
});
export type DefinitionArtifact = typeof definitionArtifactSchema.Type;
