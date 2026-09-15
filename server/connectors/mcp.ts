import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Schema } from "effect";
import { ConnectorError, ConnectorOperation } from "./definition";
import { connectorEndpoint, publicFetch } from "./public-fetch";
import type { CustomerToolSchema } from "../workspaces/tool-document";
import { redactConnectorCredential } from "./credentials";

const textOutput = {
  type: "object",
  properties: { content: { type: "string", maxLength: 50_000 } },
  required: ["content"],
  additionalProperties: false,
};

const withMcp = <A, E, R>(
  endpoint: string,
  token: string,
  operation: (client: Client) => Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        const target = connectorEndpoint(endpoint);
        const controller = new AbortController();
        const client = new Client(
          { name: "zoen-executor", version: "1.0.0" },
          { capabilities: {} }
        );
        const transport = new StreamableHTTPClientTransport(target, {
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
          },
          fetch: async (input, init) => {
            const request = new Request(input, init);
            if (request.url !== target.href)
              throw new Error("MCP attempted a different endpoint.");
            const headers = new Headers(request.headers);
            headers.delete("authorization");
            if (token) headers.set("authorization", `Bearer ${token}`);
            return publicFetch(request, {
              headers,
              signal: AbortSignal.any([controller.signal, request.signal]),
            });
          },
        });
        return { client, transport, controller };
      },
      catch: () => new ConnectorError({ reason: "unavailable" }),
    }),
    ({ client, transport }) =>
      Effect.tryPromise({
        try: (signal) => client.connect(transport, { signal, timeout: 20_000 }),
        catch: () => new ConnectorError({ reason: "unavailable" }),
      }).pipe(Effect.andThen(operation(client))),
    ({ client, controller }) =>
      Effect.promise(async () => {
        controller.abort();
        await client.close();
      })
  ).pipe(Effect.timeout("30 seconds"));

export const importMcp = Effect.fn("Connector.importMcp")(function* (
  endpoint: string,
  token: string
) {
  const operations = yield* withMcp(endpoint, token, (client) =>
    Effect.tryPromise({
      try: async (signal) => {
        const tools = [];
        let cursor: string | undefined;
        for (let page = 0; page < 5; page++) {
          // Cursor pages depend on the preceding response and cannot run in parallel.
          // oxlint-disable-next-line no-await-in-loop
          const listing = await client.listTools(cursor ? { cursor } : {}, {
            signal,
            timeout: 20_000,
          });
          const redacted: unknown = JSON.parse(
            redactConnectorCredential(JSON.stringify(listing), token)
          );
          const checked = ListToolsResultSchema.parse(redacted);
          tools.push(...checked.tools);
          if (tools.length > 100) throw new Error("Too many operations");
          cursor = listing.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error("Too many pages");
        return tools.map((tool) => ({
          id: tool.name,
          name: (tool.title ?? tool.name).slice(0, 80),
          description: (tool.description ?? tool.name).slice(0, 500),
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema ?? textOutput,
          request: { kind: "mcp", structured: !!tool.outputSchema },
        }));
      },
      catch: () => new ConnectorError({ reason: "unavailable" }),
    })
  );
  return yield* Schema.decodeUnknownEffect(Schema.Array(ConnectorOperation))(
    operations
  );
});

export const invokeMcp = Effect.fn("Connector.mcp")(
  function* <E, R>(
    endpoint: string,
    token: string,
    operation: typeof ConnectorOperation.Type,
    input: typeof CustomerToolSchema.Type.inputSchema,
    authorize: Effect.Effect<void, E, R>
  ) {
    const definition = operation.request;
    if (definition.kind !== "mcp")
      return yield* new ConnectorError({ reason: "invalid" });
    const result = yield* withMcp(endpoint, token, (client) =>
      authorize.pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: async (signal) => {
              const response = await client.callTool(
                { name: operation.id, arguments: input },
                undefined,
                { signal, timeout: 20_000 }
              );
              if (response.isError) throw new Error("Remote tool failed");
              // No image/audio/resource URLs are dereferenced or rendered implicitly.
              return definition.structured
                ? response.structuredContent
                : { content: JSON.stringify(response.content) };
            },
            catch: () => new ConnectorError({ reason: "unavailable" }),
          })
        )
      )
    );
    return yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
    )(redactConnectorCredential(JSON.stringify(result), token));
  },
  Effect.catchTag(
    "SchemaError",
    () => new ConnectorError({ reason: "invalid" })
  )
);
