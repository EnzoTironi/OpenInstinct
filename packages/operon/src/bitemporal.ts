import { Schema } from "effect";

export const ValidTime = Schema.Struct({
  validFrom: Schema.Number,
  validTo: Schema.optionalKey(Schema.Number),
});
export type ValidTime = typeof ValidTime.Type;

export const TransactionTime = Schema.Struct({
  recordedAt: Schema.Number,
  supersededAt: Schema.optionalKey(Schema.Number),
});
export type TransactionTime = typeof TransactionTime.Type;

export const BitemporalCoordinates = Schema.Struct({
  validTime: ValidTime,
  transactionTime: TransactionTime,
});
export type BitemporalCoordinates = typeof BitemporalCoordinates.Type;
