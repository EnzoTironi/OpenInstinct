import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { z } from "zod";
import { WorkspacePathSchema } from "./git";

export const ToolSlug = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,39}$/u)
);
export const ToolProposalPath = WorkspacePathSchema.check(
  Schema.isPattern(/^proposals\/tools\/[a-z][a-z0-9-]{0,39}\.json$/u)
);
export const PublishedToolPath = WorkspacePathSchema.check(
  Schema.isPattern(/^tools\/[a-z][a-z0-9-]{0,39}\.json$/u)
);
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const CodeTool = Schema.Struct({
  kind: Schema.Literal("code"),
  code: Schema.NonEmptyString.check(Schema.isMaxLength(16_000)),
  requires: Schema.Array(Schema.String.check(Schema.isMaxLength(80))).check(
    Schema.isMaxLength(12)
  ),
});

export const CustomerToolSchema = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  description: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
  inputSchema: JsonObject,
  outputSchema: JsonObject,
  implementation: CodeTool,
  tests: Schema.Array(
    Schema.Struct({
      input: JsonObject,
      expected: JsonObject,
      fixtures: Schema.Record(Schema.String, JsonObject),
    })
  ).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
});

export class CustomerToolError extends Schema.TaggedError<CustomerToolError>()(
  "CustomerToolError",
  {
    reason: Schema.Literals([
      "invalid_definition",
      "invalid_input",
      "invalid_output",
      "test_failed",
      "dependency_unavailable",
      "unavailable",
      "execution_failed",
    ]),
  }
) {}

// No references, regexes or executable schema extensions run on the host.
// Limits apply to schema structure, not just its serialized byte size.
function safeSchema(value: typeof JsonObject.Type, depth = 0): boolean {
  if (depth > 8 || Object.keys(value).length > 12) return false;
  const allowed = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "description",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "title",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (
    !["object", "array", "string", "number", "integer", "boolean"].includes(
      String(value.type)
    )
  )
    return false;
  if (value.type === "object") {
    if (
      value.additionalProperties !== false ||
      !Schema.is(JsonObject)(value.properties)
    )
      return false;
    if (Object.keys(value.properties).length > 40) return false;
    if (
      !Object.values(value.properties).every(
        (property) =>
          Schema.is(JsonObject)(property) && safeSchema(property, depth + 1)
      )
    )
      return false;
  }
  if (
    value.type === "array" &&
    (!Schema.is(JsonObject)(value.items) || !safeSchema(value.items, depth + 1))
  )
    return false;
  return true;
}

export const decodeCustomerTool = Effect.fn("CustomerTool.decode")(
  function* (content: string) {
    if (Buffer.byteLength(content) > 32_768)
      return yield* new CustomerToolError({ reason: "invalid_definition" });
    const tool = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(CustomerToolSchema)
    )(content, { onExcessProperty: "error" });
    if (
      tool.inputSchema.type !== "object" ||
      tool.outputSchema.type !== "object" ||
      !safeSchema(tool.inputSchema) ||
      !safeSchema(tool.outputSchema)
    )
      return yield* new CustomerToolError({ reason: "invalid_definition" });
    yield* Effect.try({
      try: () => {
        z.fromJSONSchema(tool.inputSchema);
        z.fromJSONSchema(tool.outputSchema);
      },
      catch: () => new CustomerToolError({ reason: "invalid_definition" }),
    });
    return tool;
  },
  Effect.catchTag(
    "SchemaError",
    () => new CustomerToolError({ reason: "invalid_definition" })
  )
);

export function customerToolId(slug: string, content: string) {
  return `custom.${slug}.v${createHash("sha256").update(content).digest("hex").slice(0, 24)}`;
}

export const decodeCustomerValue = Effect.fn("CustomerTool.decodeValue")(
  function* (
    schema: typeof JsonObject.Type,
    value: typeof JsonObject.Type,
    output = false
  ) {
    const result = yield* Effect.try({
      try: () => z.fromJSONSchema(schema).safeParse(value),
      catch: () =>
        new CustomerToolError({
          reason: output ? "invalid_output" : "invalid_input",
        }),
    });
    if (
      !result.success ||
      Buffer.byteLength(JSON.stringify(result.data)) > 65_536
    )
      return yield* new CustomerToolError({
        reason: output ? "invalid_output" : "invalid_input",
      });
    return yield* Schema.decodeUnknownEffect(JsonObject)(result.data);
  },
  Effect.catchTag(
    "SchemaError",
    () => new CustomerToolError({ reason: "invalid_output" })
  )
);
