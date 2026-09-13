import { Schema } from "effect";

/** Eve persists a plain schema carrier; Effect's callable schema cannot be stored. */
export function toolInputSchema<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S
) {
  return {
    "~standard": Schema.toStandardJSONSchemaV1(
      Schema.toStandardSchemaV1(schema, {
        parseOptions: { onExcessProperty: "error" },
      })
    )["~standard"],
  };
}
