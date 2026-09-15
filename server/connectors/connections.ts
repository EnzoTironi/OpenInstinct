import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  decodeCustomerTool,
  type CustomerToolSchema,
} from "../workspaces/tool-document";
import {
  ConnectorError,
  type ConnectorInput,
  ConnectorOperations,
  type ConnectorDiscovery,
} from "./definition";
import { connectorEndpoint } from "./public-fetch";
import { importOpenApi } from "./openapi";
import { importMcp } from "./mcp";
import {
  openConnectorCredential,
  sealConnectorCredential,
  redactConnectorCredential,
} from "./credentials";

const Connection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["mcp", "openapi"]),
  endpoint: Schema.String,
  connected_by: Schema.String,
  revision: Schema.String,
  operations: ConnectorOperations,
  share: Schema.Literals(["owner", "workspace"]),
});
const fingerprint = (input: typeof ConnectorInput.Type) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

export const listToolConnections = Effect.fn("Connector.list")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor);
      if (actor.agentGrantId) return [];
      const rows =
        yield* sql`SELECT id, name, kind, endpoint, connected_by, revision, operations, share FROM tool_connections
    WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
      AND (share = 'workspace' OR (connected_by = ${actor.userId} AND ${!actor.groupBindingId})) ORDER BY created_at`;
      return yield* Schema.decodeUnknownEffect(Schema.Array(Connection))(rows);
    })
  );
});

export const readToolConnection = Effect.fn("Connector.read")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string,
  revision?: string
) {
  const connection = (yield* listToolConnections(actor)).find(
    (entry) => entry.id === id
  );
  if (!connection || (revision && connection.revision !== revision))
    return yield* new ConnectorError({ reason: "changed" });
  return connection;
});

export const discoverToolConnections = Effect.fn("Connector.discover")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    input: typeof ConnectorDiscovery.Type
  ) {
    const connections = yield* listToolConnections(actor);
    const metadata = connections.map(({ operations, ...connection }) => ({
      ...connection,
      operationCount: operations.length,
    }));
    if (!input.connectionId) return { connections: metadata };
    const connection = connections.find(
      (entry) => entry.id === input.connectionId
    );
    if (!connection) return yield* new ConnectorError({ reason: "denied" });
    const offset = input.offset ?? 0;
    const operations = connection.operations.slice(offset, offset + 3);
    return {
      connection: metadata.find((entry) => entry.id === connection.id),
      operations,
      nextOffset:
        offset + operations.length < connection.operations.length
          ? offset + operations.length
          : null,
    };
  }
);

export const remoteToolDefinition = (
  connection: typeof Connection.Type,
  operation: (typeof ConnectorOperations.Type)[number]
) => ({
  name: operation.name,
  description: operation.description,
  inputSchema: operation.inputSchema,
  outputSchema: operation.outputSchema,
  implementation: {
    kind: connection.kind,
    connectionId: connection.id,
    revision: connection.revision,
    operation: operation.id,
  },
  tests: [],
});

export const requireRemoteTool = Effect.fn("Connector.requireTool")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  definition: typeof CustomerToolSchema.Type
) {
  const implementation = definition.implementation;
  if (implementation.kind === "code")
    return yield* new ConnectorError({ reason: "invalid" });
  const connection = yield* readToolConnection(
    actor,
    implementation.connectionId,
    implementation.revision
  );
  const operation = connection.operations.find(
    (entry) => entry.id === implementation.operation
  );
  if (
    !operation ||
    connection.kind !== implementation.kind ||
    !isDeepStrictEqual(operation.inputSchema, definition.inputSchema) ||
    !isDeepStrictEqual(operation.outputSchema, definition.outputSchema)
  )
    return yield* new ConnectorError({ reason: "changed" });
  return { connection, operation };
});

export const connectTools = Effect.fn("Connector.connect")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  input: typeof ConnectorInput.Type
) {
  yield* requireWorkspaceAccess(actor, true);
  if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
  yield* Effect.try({
    try: () => connectorEndpoint(input.endpoint),
    catch: () => new ConnectorError({ reason: "invalid" }),
  });
  if (/[\r\n]/u.test(input.credential))
    return yield* new ConnectorError({ reason: "invalid" });
  const sql = yield* PgClient.PgClient;
  const hash = fingerprint(input);
  const existing =
    yield* sql`SELECT id FROM tool_connections WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId}
    AND connected_by = ${actor.userId} AND request_hash = ${hash} AND revoked_at IS NULL`;
  if (existing.length) return yield* readToolConnection(actor, input.id);
  const imported =
    input.kind === "mcp"
      ? yield* importMcp(input.endpoint, input.credential)
      : yield* importOpenApi(
          redactConnectorCredential(input.document ?? "", input.credential)
        );
  const operations =
    yield* Schema.decodeUnknownEffect(ConnectorOperations)(imported);
  if (
    new Set(operations.map((operation) => operation.id)).size !==
    operations.length
  )
    return yield* new ConnectorError({ reason: "invalid" });
  const revision = randomUUID();
  const candidate = {
    ...input,
    revision,
    operations,
    connected_by: actor.userId,
  };
  // Import uses the same schema owner as publication, rejecting unsupported
  // refs or schema extensions before any remote operation becomes discoverable.
  yield* Effect.forEach(operations, (operation) =>
    decodeCustomerTool(
      JSON.stringify(remoteToolDefinition(candidate, operation))
    )
  );
  const credentials = yield* sealConnectorCredential(
    actor.workspaceId,
    input.id,
    revision,
    input.credential
  );
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const access = yield* requireWorkspaceAccess(actor, true);
      yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5861))`;
      const active =
        yield* sql`SELECT id FROM tool_connections WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`;
      if (active.length >= 20)
        return yield* new ConnectorError({ reason: "unavailable" });
      const inserted =
        yield* sql`INSERT INTO tool_connections(id, workspace_id, connected_by, organization_id, name, kind, endpoint, credentials, revision, operations, share, request_hash)
      VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${access.organizationId}, ${input.name}, ${input.kind}, ${input.endpoint}, ${credentials}, ${revision}, ${JSON.stringify(operations)}::jsonb, ${input.share}, ${hash})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
      if (!inserted.length)
        return yield* new ConnectorError({ reason: "changed" });
      return undefined;
    })
  );
  return yield* readToolConnection(actor, input.id);
});

export const revokeToolConnection = Effect.fn("Connector.revoke")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor, true);
      yield* sql`UPDATE tool_connections SET credentials = NULL, revoked_at = now(), revision = ${randomUUID()}
    WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`;
      yield* sql`UPDATE tool_invocations SET result = NULL WHERE connection_id = ${id} AND workspace_id = ${actor.workspaceId}`;
      return undefined;
    })
  );
});

export const toolConnectionCredentials = Effect.fn("Connector.credentials")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    id: string,
    revision: string
  ) {
    yield* readToolConnection(actor, id, revision);
    const sql = yield* PgClient.PgClient;
    const rows =
      yield* sql`SELECT credentials FROM tool_connections WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND revision = ${revision} AND revoked_at IS NULL`;
    const row = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ credentials: Schema.String })
    )(rows[0]);
    return yield* openConnectorCredential(
      actor.workspaceId,
      id,
      revision,
      row.credentials
    );
  }
);
