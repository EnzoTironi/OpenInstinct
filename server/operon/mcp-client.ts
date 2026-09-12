import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";

export class OperonMcpError extends Schema.TaggedError<OperonMcpError>()(
  "OperonMcpError",
  {
    error: Schema.String,
    message: Schema.String,
  }
) {}

export const OperonToolName = Schema.Literals([
  "operon_ingest_source",
  "operon_propose_mapping",
  "operon_review_mapping_proposal",
  "operon_admit_mapping_proposal",
  "operon_search_quarantine",
  "operon_derive_identity_keys",
  "operon_query_objects",
  "operon_get_admission",
]);

export type OperonToolName = typeof OperonToolName.Type;

export const ToolResult = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  body: Schema.Json,
});

export type ToolResult = typeof ToolResult.Type;

export interface OperonToolClient {
  readonly call: (
    name: OperonToolName,
    args: typeof Schema.JsonObject.Type
  ) => Effect.Effect<ToolResult, OperonMcpError>;
}

const decodeToolResult = Schema.decodeUnknownEffect(ToolResult);
const decodeTextPart = Schema.decodeUnknownOption(
  Schema.Struct({ text: Schema.String })
);

export class OperonMcpClient extends Context.Service<
  OperonMcpClient,
  OperonToolClient
>()("companion/operon/OperonMcpClient") {}

export class OperonBuilder extends Context.Service<
  OperonBuilder,
  OperonToolClient
>()("companion/operon/OperonBuilder") {}

export const unavailableClient: OperonToolClient = {
  call: Effect.fn("OperonMcpClient.unavailable")(function* (name: string) {
    return yield* new OperonMcpError({
      error: "OperonUnavailable",
      message: `Operon MCP is not linked (${name})`,
    });
  }),
};

interface StdioSpawn {
  readonly command: string;
  readonly args: readonly string[];
}

function spawnFromHome(home: string): StdioSpawn {
  return {
    args: [
      join(home, "packages/cli/dist/bin.js"),
      "mcp",
      "start",
      "--agent-tier",
      "2",
    ],
    command: process.execPath,
  };
}

function spawnFromCommand(command: string): StdioSpawn {
  const [binary, ...args] = command.trim().split(/\s+/u);
  return { args, command: binary ?? command };
}

function resolveSpawn(
  home: Option.Option<string>,
  command: Option.Option<string>
): Option.Option<StdioSpawn> {
  if (Option.isSome(command)) return Option.some(spawnFromCommand(command.value));
  if (Option.isSome(home)) return Option.some(spawnFromHome(home.value));
  return Option.none();
}

function firstText(content: typeof Schema.Json.Type) {
  if (!Array.isArray(content)) return "{}";
  const part = decodeTextPart(content[0]);
  return Option.isSome(part) ? part.value.text : "{}";
}

const decodeJsonText = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json)
);

function parseJsonText(text: string): typeof Schema.Json.Type {
  return Option.getOrElse(decodeJsonText(text), () => ({ text }));
}

function parseToolContent(content: typeof Schema.Json.Type) {
  return Effect.succeed(parseJsonText(firstText(content)));
}

const McpSdkResult = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  content: Schema.Json,
});

const decodeSdkResult = Schema.decodeUnknownEffect(McpSdkResult);

function toolClientFromMcp(client: Client): OperonToolClient {
  return {
    call: Effect.fn("OperonMcpClient.call")(function* (
      name: OperonToolName,
      args: typeof Schema.JsonObject.Type
    ) {
      const raw = yield* Effect.tryPromise({
        catch: (cause) =>
          new OperonMcpError({
            error: "OperonTransportError",
            message: String(cause),
          }),
        try: () => client.callTool({ arguments: args, name }),
      });
      const decoded = yield* decodeSdkResult(raw).pipe(
        Effect.mapError(
          () =>
            new OperonMcpError({
              error: "OperonDecodeError",
              message: `Invalid tool result for ${name}`,
            })
        )
      );
      const body = yield* parseToolContent(decoded.content);
      return yield* decodeToolResult({
        body,
        ...(decoded.isError === true ? { isError: true } : {}),
      }).pipe(
        Effect.mapError(
          () =>
            new OperonMcpError({
              error: "OperonDecodeError",
              message: `Invalid tool result for ${name}`,
            })
        )
      );
    }),
  };
}

const connectStdio = (spec: StdioSpawn) =>
  Effect.tryPromise({
    catch: (cause) =>
      new OperonMcpError({
        error: "OperonTransportError",
        message: String(cause),
      }),
    try: async () => {
      const transport = new StdioClientTransport({
        args: [...spec.args],
        command: spec.command,
      });
      const client = new Client(
        { name: "companion-operon", version: "0.0.0" },
        { capabilities: {} }
      );
      await client.connect(transport);
      return client;
    },
  });

const makeStdioClient = Effect.fn("OperonMcpClient.stdio")(function* () {
  const home = yield* Config.option(Config.string("OPERON_HOME"));
  const command = yield* Config.option(Config.string("OPERON_MCP_COMMAND"));
  const spec = resolveSpawn(home, command);
  if (Option.isNone(spec)) return unavailableClient;
  const client = yield* Effect.acquireRelease(connectStdio(spec.value), (mcp) =>
    Effect.promise(() => mcp.close())
  );
  return toolClientFromMcp(client);
});

export const OperonMcpClientStdio = Layer.effect(
  OperonMcpClient,
  makeStdioClient
);

const builderEnabled = Config.boolean("OPERON_BUILDER_ENABLED").pipe(
  Config.withDefault(false)
);

const makeBuilder = Effect.fn("OperonBuilder.stdio")(function* () {
  const enabled = yield* builderEnabled;
  if (!enabled) return unavailableClient;
  return yield* makeStdioClient();
});

export const OperonBuilderStdio = Layer.effect(OperonBuilder, makeBuilder);
