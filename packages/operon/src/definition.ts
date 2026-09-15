import { Schema } from "effect";

import { DataClassification, EntityTypology } from "./types";

export const EffectClass = Schema.Literals([
  "read_only",
  "state_mutation",
  "external_side_effect",
]);
export type EffectClass = typeof EffectClass.Type;

export const PropertyDef = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["string", "number", "boolean", "date", "json"]),
  required: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
});
export type PropertyDef = typeof PropertyDef.Type;

export const TypeDef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  properties: Schema.Record(Schema.String, PropertyDef),
  primaryKey: Schema.String,
  typology: Schema.optional(EntityTypology),
  classification: Schema.optional(DataClassification),
});
export type TypeDef = typeof TypeDef.Type;

export const LinkDef = Schema.Struct({
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
export type LinkDef = typeof LinkDef.Type;

export const QueryDef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  returnTypeId: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.String),
  description: Schema.optional(Schema.String),
});
export type QueryDef = typeof QueryDef.Type;

export const ActionDef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  effectClass: EffectClass,
  riskTier: Schema.Literals(["low", "moderate", "high", "critical"]),
  parametersSchema: Schema.Record(Schema.String, Schema.String),
  requiredRoles: Schema.Array(Schema.String),
});
export type ActionDef = typeof ActionDef.Type;

export const DefinitionArtifact = Schema.Struct({
  types: Schema.Array(TypeDef),
  links: Schema.Array(LinkDef),
  queries: Schema.Array(QueryDef),
  actions: Schema.Array(ActionDef),
});
export type DefinitionArtifact = typeof DefinitionArtifact.Type;
