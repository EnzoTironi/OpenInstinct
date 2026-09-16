import { Schema } from "effect";

import { linkTypeIdSchema, objectTypeIdSchema } from "./types";

export const linkCardinalitySchema = Schema.Literals([
  "one-to-one",
  "one-to-many",
  "many-to-many",
]);
export type LinkCardinality = typeof linkCardinalitySchema.Type;

export const linkTypeSchema = Schema.Struct({
  id: linkTypeIdSchema,
  description: Schema.String,
  sourceTypeId: objectTypeIdSchema,
  targetTypeId: objectTypeIdSchema,
  sourceToTargetName: Schema.String,
  targetToSourceName: Schema.String,
  cardinality: linkCardinalitySchema,
  cascadeDelete: Schema.optionalKey(Schema.Boolean),
});
export type LinkType = typeof linkTypeSchema.Type;

export interface LinkTypeConfig {
  readonly id: string;
  readonly description: string;
  readonly sourceTypeId: string;
  readonly targetTypeId: string;
  readonly sourceToTargetName: string;
  readonly targetToSourceName: string;
  readonly cardinality: LinkCardinality;
  readonly cascadeDelete?: boolean;
}

export function defineLinkType(config: LinkTypeConfig): LinkType {
  return {
    ...config,
    id: linkTypeIdSchema.make(config.id),
    sourceTypeId: objectTypeIdSchema.make(config.sourceTypeId),
    targetTypeId: objectTypeIdSchema.make(config.targetTypeId),
  };
}

export const linkInstanceSchema = Schema.Struct({
  linkTypeId: linkTypeIdSchema,
  sourceId: Schema.String,
  targetId: Schema.String,
  createdAt: Schema.Number,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type LinkInstance = typeof linkInstanceSchema.Type;
