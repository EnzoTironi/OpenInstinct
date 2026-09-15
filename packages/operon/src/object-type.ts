import { Schema } from "effect";

import type { ValueType } from "./value-types";
import {
  ObjectTypeId,
  Provenance,
  type DataClassification,
  type EntityTypology,
  type FreshnessBudget,
} from "./types";

export const ObjectProperties = Schema.Record(Schema.String, Schema.Json);
export type ObjectProperties = typeof ObjectProperties.Type;

export interface PropertyDefinition<T = Schema.Json> {
  readonly schema: Schema.Codec<T, unknown, never>;
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
  Props extends Record<string, PropertyDefinition> = Record<
    string,
    PropertyDefinition
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
  Props extends Record<string, PropertyDefinition>,
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
  Props extends Record<string, PropertyDefinition>,
  PK extends keyof Props & string,
>(config: ObjectTypeConfig<Props, PK>): ObjectType<Props> {
  return {
    ...config,
    id: ObjectTypeId.make(config.id),
  };
}

export function defineProperty<T>(
  config: PropertyDefinition<T>
): PropertyDefinition<T> {
  return config;
}

export const ObjectInstanceSchema = Schema.Struct({
  id: Schema.String,
  typeId: ObjectTypeId,
  properties: ObjectProperties,
  provenance: Schema.optionalKey(Provenance),
  lastModifiedAt: Schema.Number,
  validFrom: Schema.optionalKey(Schema.Number),
  validTo: Schema.optionalKey(Schema.Number),
  version: Schema.Number,
});

export type ObjectInstance = typeof ObjectInstanceSchema.Type;
