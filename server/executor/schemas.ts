import { Effect, Predicate, Schema } from "effect";
import type { ExecutorTool } from "./definition";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import { ExecutorCatalogError } from "./errors";

const jsonCarrier = Schema.declare<StandardJSONSchemaV1>(
  (value): value is StandardJSONSchemaV1 =>
    Predicate.hasProperty(value, "~standard") &&
    Predicate.hasProperty(value["~standard"], "jsonSchema") &&
    Predicate.hasProperty(value["~standard"].jsonSchema, "input") &&
    Predicate.isFunction(value["~standard"].jsonSchema.input)
);

// Eve's public heterogeneous catalog carries schema-specific input types.
// Validate with each owner's Standard Schema, including refinements and defaults.
export function describeToolSchema(schema: ExecutorTool["inputSchema"]) {
  if (Predicate.hasProperty(schema, "~standard")) {
    const standard = schema["~standard"];
    if (Predicate.hasProperty(standard, "jsonSchema")) {
      const carrier = Schema.decodeUnknownSync(jsonCarrier)(schema);
      return carrier["~standard"].jsonSchema.input({ target: "draft-2020-12" });
    }
    throw new Error("Executor tools must publish a JSON Schema.");
  }
  return schema;
}

export const decodeToolInput = Effect.fn("Executor.decodeToolInput")(function* (
  schema: ExecutorTool["inputSchema"],
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Standard Schema is the owning runtime decoder at this boundary.
  input: unknown
) {
  const result = yield* Effect.tryPromise({
    try: async () => {
      if (Predicate.hasProperty(schema, "~standard")) {
        const standard = schema["~standard"];
        if (
          Predicate.hasProperty(standard, "validate") &&
          Predicate.isFunction(standard.validate)
        )
          return standard.validate(input);
      }
      const validator = z.fromJSONSchema(describeToolSchema(schema));
      return validator["~standard"].validate(input);
    },
    catch: () => new ExecutorCatalogError({ reason: "invalid_input" }),
  });
  if (result.issues)
    return yield* new ExecutorCatalogError({ reason: "invalid_input" });
  return yield* Schema.decodeUnknownEffect(
    Schema.Record(Schema.String, Schema.Unknown)
  )(result.value);
});
