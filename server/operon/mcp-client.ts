import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AccessScope } from "@shared/identity/access-scope";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";

export class OperonMcpError extends Schema.TaggedError<OperonMcpError>()(
  "OperonMcpError",
  {
    error: Schema.String,
    message: Schema.String,
  }
) {}

/** Published Operon MCP env for ApproverBinding. */
export const APPROVER_SESSION_TOKEN_ENV = "OPERON_APPROVER_SESSION_TOKEN";

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

export type OperonMcpRole = "consumer" | "builder";

export interface OperonMcpSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

interface ClientOptions {
  readonly scope: AccessScope;
  readonly role: OperonMcpRole;
  readonly sessionToken: string;
  readonly confirm?: boolean;
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

const inheritedEnvKeys = [
  "HOME",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "NODE_ENV",
] as const;

function stdioEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of inheritedEnvKeys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

function unavailableClient() {
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

/**
 * Stdio spawn for Operon MCP.
 *
 * Context: Companion is the Better Auth host. Operon parses Principal at the edge.
 * Inputs: built CLI home, cell database URL, human session.token, optional auth secret, MCP role, workspace.
 * Outputs: node command, `mcp start` args, env with OPERON_APPROVER_SESSION_TOKEN.
 * Side effects: none. Callers spawn.
 * Does not spawn `operon approver session` and does not pass `--host-approver`.
 */
export function buildOperonMcpSpawn(input: {
  readonly home: string;
  readonly databaseUrl: string;
  readonly sessionToken: string;
  readonly authSecret?: string;
  readonly role: OperonMcpRole;
  readonly workspaceId: string;
}): OperonMcpSpawn {
  const role = input.role;
  switch (role) {
    case "consumer":
    case "builder":
      break;
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
  const env = stdioEnv({
    OPERON_DATABASE_URL: input.databaseUrl,
    [APPROVER_SESSION_TOKEN_ENV]: input.sessionToken,
  });
  if (input.authSecret !== undefined) {
    env.OPERON_AUTH_SECRET = input.authSecret;
  }
  return {
    command: process.execPath,
    args: [
      join(input.home, "packages/cli/dist/bin.js"),
      "mcp",
      "start",
      "--agent-tier",
      "2",
      "--role",
      role,
      "--workspace",
      input.workspaceId,
    ],
    env,
  };
}

function builderConfirmed(options: ClientOptions, enabled: boolean) {
  switch (options.role) {
    case "consumer":
      return true;
    case "builder":
      return enabled && options.confirm === true;
    default: {
      const exhaustive: never = options.role;
      return exhaustive;
    }
  }
}

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
      const authSecret = yield* Config.option(
        Config.string("OPERON_AUTH_SECRET")
      ).pipe(
        Effect.flatMap((value) =>
          Option.match(value, {
            onNone: () => Config.option(Config.string("BETTER_AUTH_SECRET")),
            onSome: (secret) => Effect.succeed(Option.some(secret)),
          })
        )
      );
      if (
        Option.isNone(home) ||
        Option.isNone(database) ||
        options.sessionToken.length === 0 ||
        !builderConfirmed(options, enabled)
      ) {
        return unavailableClient();
      }
      const spawn = buildOperonMcpSpawn({
        home: home.value,
        databaseUrl: database.value,
        sessionToken: options.sessionToken,
        authSecret: Option.getOrUndefined(authSecret),
        role: options.role,
        workspaceId: options.scope.workspaceId,
      });
      const client = new Client(
        { name: "zoen-operon", version: "1.0.0" },
        { capabilities: {} }
      );
      const transport = new StdioClientTransport({
        args: [...spawn.args],
        command: spawn.command,
        env: { ...spawn.env },
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
