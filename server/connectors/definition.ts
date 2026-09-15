import { Schema } from "effect";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
export const ConnectorOperation = Schema.Struct({
  id: Schema.NonEmptyString.check(Schema.isMaxLength(120)),
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  description: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
  inputSchema: JsonObject,
  outputSchema: JsonObject,
  request: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("mcp"), structured: Schema.Boolean }),
    Schema.Struct({
      kind: Schema.Literal("openapi"),
      method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: Schema.String.check(Schema.isMaxLength(500)),
      pathParameters: Schema.Array(Schema.String),
      queryParameters: Schema.Array(Schema.String),
      body: Schema.Boolean,
    }),
  ]),
});
export const ConnectorOperations = Schema.Array(ConnectorOperation).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100)
);
export const ConnectorDiscovery = Schema.Struct({
  connectionId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  offset: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
  ),
});
export class ConnectorError extends Schema.TaggedError<ConnectorError>()(
  "ConnectorError",
  {
    reason: Schema.Literals([
      "invalid",
      "unavailable",
      "changed",
      "denied",
      "uncertain",
    ]),
  }
) {}

export const ConnectorInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  endpoint: Schema.NonEmptyString.check(Schema.isMaxLength(1000)),
  kind: Schema.Literals(["mcp", "openapi"]),
  credential: Schema.String.check(Schema.isMaxLength(8000)),
  share: Schema.Literals(["owner", "workspace"]),
  document: Schema.optional(Schema.String.check(Schema.isMaxLength(262_144))),
});
