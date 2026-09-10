import { Schema } from "effect";
import { PackPlanesSchema } from "./types";
import { NounDefinitionSchema, VerbDefinitionSchema } from "./types";

export const OntologyPackIdSchema = Schema.NonEmptyString.check(
  Schema.isTrimmed()
);
export type OntologyPackId = typeof OntologyPackIdSchema.Type;

export const OntologyPackManifestSchema = Schema.Struct({
  hooks: Schema.Struct({
    erasure: Schema.Boolean,
    mcp: Schema.Boolean,
    receipts: Schema.Boolean,
  }),
  id: OntologyPackIdSchema,
  nouns: Schema.Array(NounDefinitionSchema),
  planes: PackPlanesSchema,
  /** Semver-ish pack revision; Worlds skeleton is "0". */
  title: Schema.NonEmptyString.check(Schema.isTrimmed()),
  verbs: Schema.Array(VerbDefinitionSchema),
  version: Schema.NonEmptyString.check(Schema.isTrimmed()),
});
export type OntologyPackManifest = typeof OntologyPackManifestSchema.Type;
