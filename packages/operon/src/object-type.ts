import { Schema } from "effect";

import type { ValueType } from "./value-types";
import {
  objectTypeIdSchema,
  provenanceSchema,
  type DataClassification,
  type EntityTypology,
  type FreshnessBudget,
  type ObjectTypeId,
} from "./types";

export const objectPropertiesSchema = Schema.Record(Schema.String, Schema.Json);
export type ObjectProperties = typeof objectPropertiesSchema.Type;

export interface PropertyDefinition<T> {
  readonly schema: Schema.Codec<T, unknown>;
  readonly description: string;
  readonly valueType?: ValueType<T>;
  readonly required?: boolean;
  readonly defaultValue?: T;
  readonly freshnessBudget?: FreshnessBudget;
  readonly classification?: DataClassification;
  readonly isDerived?: boolean;
  readonly derivedFrom?: readonly string[];
}

export interface ObjectType<
  Props extends Record<string, PropertyDefinition<Schema.Json>> = Record<
    string,
    PropertyDefinition<Schema.Json>
  >,
> {
  readonly id: ObjectTypeId;
  readonly name: string;
  readonly description: string;
  readonly typology: EntityTypology;
  readonly primaryKey: string;
  readonly properties: Props;
  readonly implementedInterfaces?: readonly string[];
  readonly immutableProperties?: readonly string[];
}

export interface ObjectTypeConfig<
  Props extends Record<string, PropertyDefinition<Schema.Json>>,
  PK extends keyof Props & string,
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly typology: EntityTypology;
  readonly primaryKey: PK;
  readonly properties: Props;
  readonly implementedInterfaces?: readonly string[];
  readonly immutableProperties?: readonly (keyof Props & string)[];
}

export function defineObjectType<
  Props extends Record<string, PropertyDefinition<Schema.Json>>,
  PK extends keyof Props & string,
>(config: ObjectTypeConfig<Props, PK>): ObjectType<Props> {
  return {
    ...config,
    id: objectTypeIdSchema.make(config.id),
  };
}

export function defineProperty<T>(
  config: PropertyDefinition<T>
): PropertyDefinition<T> {
  return config;
}

export const ObjectInstanceSchema = Schema.Struct({
  id: Schema.String,
  typeId: objectTypeIdSchema,
  properties: objectPropertiesSchema,
  provenance: Schema.optionalKey(provenanceSchema),
  lastModifiedAt: Schema.Number,
  validFrom: Schema.optionalKey(Schema.Number),
  validTo: Schema.optionalKey(Schema.Number),
  version: Schema.Number,
});

export type ObjectInstance = typeof ObjectInstanceSchema.Type;
