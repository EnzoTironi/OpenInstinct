import { Schema } from "effect";
const definitionId = Schema.NonEmptyString.check(Schema.isTrimmed());

/** Language-plane noun (object type) skeleton. */
export const NounDefinitionSchema = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  id: definitionId,
  kind: Schema.Literal("noun"),
  label: Schema.NonEmptyString.check(Schema.isTrimmed()),
  plane: Schema.Literal("language"),
});
export type NounDefinition = typeof NounDefinitionSchema.Type;

/** Language-plane verb (action type) skeleton. */
export const VerbDefinitionSchema = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  id: definitionId,
  kind: Schema.Literal("verb"),
  label: Schema.NonEmptyString.check(Schema.isTrimmed()),
  nounIds: Schema.optionalKey(Schema.Array(definitionId)),
  plane: Schema.Literal("language"),
});
export type VerbDefinition = typeof VerbDefinitionSchema.Type;

export const OntologyDefinitionSchema = Schema.Union([
  NounDefinitionSchema,
  VerbDefinitionSchema,
]);
export type OntologyDefinition = typeof OntologyDefinitionSchema.Type;

/** Declared plane coverage on a pack (Language / Engine / Security). */
export const PackPlanesSchema = Schema.Struct({
  engine: Schema.Boolean,
  language: Schema.Boolean,
  security: Schema.Boolean,
});
export type PackPlanes = typeof PackPlanesSchema.Type;
