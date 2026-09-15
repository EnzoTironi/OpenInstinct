import { Effect, Schema } from "effect";
import { ConnectorError, ConnectorOperation } from "./definition";
import { connectorEndpoint, publicFetch } from "./public-fetch";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const Media = Schema.Struct({
  content: Schema.Record(Schema.String, Schema.Struct({ schema: JsonObject })),
});
const Parameter = Schema.Struct({
  name: Schema.String,
  in: Schema.Literals(["path", "query"]),
  required: Schema.optional(Schema.Boolean),
  schema: JsonObject,
});
const Operation = Schema.Struct({
  operationId: Schema.String,
  summary: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  parameters: Schema.optional(Schema.Array(Parameter)),
  requestBody: Schema.optional(Media),
  responses: Schema.Record(Schema.String, Media),
});
const Document = Schema.Struct({
  openapi: Schema.String.check(Schema.isPattern(/^3\.(0|1)\./u)),
  paths: Schema.Record(Schema.String, JsonObject),
});

/** Import a bounded JSON OpenAPI operation set. No remote $ref resolution,
 * server overrides, header/cookie parameters, or implicit schema coercion.
 */
export const importOpenApi = Effect.fn("Connector.importOpenApi")(
  function* (content: string) {
    const document = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Document)
    )(content);
    const operations: (typeof ConnectorOperation.Type)[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      if (
        !/^\/[A-Za-z0-9_/{}.~-]*$/u.test(path) ||
        path.includes("..") ||
        path.startsWith("//") ||
        item.parameters
      )
        return yield* new ConnectorError({ reason: "invalid" });
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        if (!item[method]) continue;
        const operation = yield* Schema.decodeUnknownEffect(Operation)(
          item[method]
        );
        const parameters = operation.parameters ?? [];
        if (
          new Set(parameters.map((parameter) => parameter.name)).size !==
          parameters.length
        )
          return yield* new ConnectorError({ reason: "invalid" });
        if (
          parameters.some(
            (parameter) =>
              !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(parameter.name)
          )
        )
          return yield* new ConnectorError({ reason: "invalid" });
        const pathParameters = parameters
          .filter((p) => p.in === "path")
          .map((p) => p.name);
        const placeholders = Array.from(
          path.matchAll(/\{([^}]+)\}/gu),
          (match) => match[1]
        );
        if (
          placeholders.some((name) => !pathParameters.includes(name ?? "")) ||
          pathParameters.some((name) => !placeholders.includes(name))
        )
          return yield* new ConnectorError({ reason: "invalid" });
        const body = operation.requestBody?.content["application/json"]?.schema;
        if ((operation.requestBody && !body) || (body && method === "get"))
          return yield* new ConnectorError({ reason: "invalid" });
        const response =
          operation.responses["200"] ?? operation.responses["201"];
        const outputSchema = response?.content["application/json"]?.schema;
        if (!outputSchema)
          return yield* new ConnectorError({ reason: "invalid" });
        const properties = Object.fromEntries(
          parameters.map((p) => [p.name, p.schema])
        );
        if (body && properties.body)
          return yield* new ConnectorError({ reason: "invalid" });
        if (body) properties.body = body;
        const inputSchema = {
          type: "object",
          properties,
          required: [
            ...parameters
              .filter((p) => p.required === true || p.in === "path")
              .map((p) => p.name),
            ...(body ? ["body"] : []),
          ],
          additionalProperties: false,
        };
        operations.push(
          yield* Schema.decodeUnknownEffect(ConnectorOperation)({
            id: operation.operationId,
            name: (operation.summary ?? operation.operationId).slice(0, 80),
            description: (
              operation.description ??
              operation.summary ??
              operation.operationId
            ).slice(0, 500),
            inputSchema,
            outputSchema,
            request: {
              kind: "openapi",
              method: method.toUpperCase(),
              path,
              pathParameters,
              queryParameters: parameters
                .filter((p) => p.in === "query")
                .map((p) => p.name),
              body: !!body,
            },
          })
        );
      }
    }
    return operations;
  },
  Effect.catchTag(
    "SchemaError",
    () => new ConnectorError({ reason: "invalid" })
  )
);

export const invokeOpenApi = Effect.fn("Connector.openApi")(
  function* (
    endpoint: string,
    token: string,
    operation: typeof ConnectorOperation.Type,
    input: typeof JsonObject.Type,
    operationId: string
  ) {
    const definition = operation.request;
    if (definition.kind !== "openapi")
      return yield* new ConnectorError({ reason: "invalid" });
    const url = connectorEndpoint(endpoint);
    let path = definition.path;
    for (const name of definition.pathParameters) {
      const value = yield* Schema.decodeUnknownEffect(
        Schema.Union([Schema.String, Schema.Number])
      )(input[name]);
      if (String(value) === "." || String(value) === "..")
        return yield* new ConnectorError({ reason: "invalid" });
      path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
    }
    url.pathname = `${url.pathname.replace(/\/$/u, "")}${path}`;
    for (const name of definition.queryParameters) {
      const value = input[name];
      if (value !== undefined) {
        const scalar = yield* Schema.decodeUnknownEffect(
          Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
        )(value);
        url.searchParams.set(name, String(scalar));
      }
    }
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": operationId,
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const text = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await publicFetch(url, {
          method: definition.method,
          signal,
          headers,
          body: definition.body ? JSON.stringify(input.body) : undefined,
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          throw new Error("Unavailable");
        return response.text();
      },
      catch: () => new ConnectorError({ reason: "unavailable" }),
    });
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(JsonObject))(
      text
    );
  },
  Effect.catchTag(
    "SchemaError",
    () => new ConnectorError({ reason: "invalid" })
  )
);
