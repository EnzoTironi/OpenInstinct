import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AccessScope } from "@shared/identity/access-scope";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { z } from "zod";

export class OperonMcpError extends Schema.TaggedError<OperonMcpError>()(
  "OperonMcpError",
  {
    error: Schema.String,
    message: Schema.String,
  }
) {}

const OperonToolNameSchema = Schema.Literals([
  "operon_ingest_source",
  "operon_propose_mapping",
  "operon_review_mapping_proposal",
  "operon_admit_mapping_proposal",
  "operon_search_quarantine",
  "operon_derive_identity_keys",
  "operon_query_objects",
  "operon_get_admission",
]);
export type OperonToolName = typeof OperonToolNameSchema.Type;
const ToolResultSchema = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  body: Schema.Json,
});
export type ToolResult = typeof ToolResultSchema.Type;

export class OperonMcpClient extends Context.Service<
  OperonMcpClient,
  {
    readonly call: (
      name: OperonToolName,
      args: typeof Schema.JsonObject.Type
    ) => Effect.Effect<ToolResult, OperonMcpError>;
  }
>()("zoen/operon/OperonMcpClient") {}

const ApprovalRequest = z.object({
  method: z.literal("operon/verify-approval"),
  params: z.object({
    tool: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
});
export type OperonApprovalRequest = z.infer<typeof ApprovalRequest>["params"];
interface ClientOptions {
  readonly scope: AccessScope;
  readonly role: "consumer" | "builder";
  readonly approve?: (
    request: OperonApprovalRequest
  ) => Promise<typeof Schema.JsonObject.Type>;
}

const decodeResult = Schema.decodeUnknownEffect(
  Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    content: Schema.Array(
      Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })
    ).check(Schema.isMinLength(1)),
  })
);
const decodeBody = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);
const transportError = () =>
  new OperonMcpError({
    error: "OperonTransportError",
    message: "Não foi possível conversar com o Operon.",
  });

/** The host selects identity, database and role. None are model-supplied tool arguments. */
export function operonClientLayer(options: ClientOptions) {
  return Layer.effect(
    OperonMcpClient,
    Effect.gen(function* () {
      const home = yield* Config.option(Config.string("OPERON_HOME"));
      const database = yield* Config.option(
        Config.string("OPERON_DATABASE_URL")
      );
      const enabled = yield* Config.boolean("OPERON_BUILDER_ENABLED").pipe(
        Config.withDefault(false)
      );
      if (
        Option.isNone(home) ||
        Option.isNone(database) ||
        (options.role === "builder" && !enabled)
      ) {
        return OperonMcpClient.of({
          call: () =>
            Effect.fail(
              new OperonMcpError({
                error: "OperonUnavailable",
                message: "A conexão com o Operon ainda não está configurada.",
              })
            ),
        });
      }
      const client = new Client(
        { name: "zoen-operon", version: "1.0.0" },
        {
          capabilities: {
            experimental: options.approve ? { "operon/approval": {} } : {},
          },
        }
      );
      if (options.approve) {
        const approve = options.approve;
        client.setRequestHandler(ApprovalRequest, async (request) => ({
          principal: await approve(request.params),
        }));
      }
      const transport = new StdioClientTransport({
        args: [
          join(home.value, "packages/cli/dist/bin.js"),
          "mcp",
          "start",
          "--agent-tier",
          "2",
          "--role",
          options.role,
          "--workspace",
          options.scope.workspaceId,
          ...(options.approve ? ["--host-approver"] : []),
        ],
        command: process.execPath,
        env: {
          OPERON_DATABASE_URL: database.value,
        },
        stderr: "pipe",
      });
      // Register cleanup before connecting, including cancellation during startup.
      yield* Effect.acquireRelease(Effect.succeed(client), (mcp) =>
        Effect.promise(() => mcp.close())
      );
      yield* Effect.tryPromise({
        try: () => client.connect(transport),
        catch: transportError,
      });
      return OperonMcpClient.of({
        call: Effect.fn("OperonMcpClient.call")(function* (name, args) {
          const raw = yield* Effect.tryPromise({
            try: (signal) =>
              client.callTool(
                {
                  name,
                  arguments: { ...args, tenantId: options.scope.workspaceId },
                },
                undefined,
                { signal }
              ),
            catch: transportError,
          });
          const decoded = yield* decodeResult(raw).pipe(
            Effect.mapError(transportError)
          );
          const body = yield* decodeBody(decoded.content[0]?.text).pipe(
            Effect.mapError(transportError)
          );
          return decoded.isError === true ? { body, isError: true } : { body };
        }),
      });
    })
  );
}
