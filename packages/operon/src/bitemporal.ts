import { Schema } from "effect";

export const validTimeSchema = Schema.Struct({
  validFrom: Schema.Number,
  validTo: Schema.optionalKey(Schema.Number),
});
export type ValidTime = typeof validTimeSchema.Type;

export const transactionTimeSchema = Schema.Struct({
  recordedAt: Schema.Number,
  supersededAt: Schema.optionalKey(Schema.Number),
});
export type TransactionTime = typeof transactionTimeSchema.Type;

export const bitemporalCoordinatesSchema = Schema.Struct({
  validTime: validTimeSchema,
  transactionTime: transactionTimeSchema,
});
export type BitemporalCoordinates = typeof bitemporalCoordinatesSchema.Type;
