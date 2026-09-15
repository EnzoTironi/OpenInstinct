import { Effect, Schema } from "effect";
import { serverRuntime } from "../../server/runtime";
import {
  CustomerToolPublication,
  CustomerToolRollback,
  disableCustomerTool,
  listCustomerTools,
  publishCustomerTool,
  rollbackCustomerTool,
  validateCustomerTool,
} from "../../server/workspaces/tools";
import { workspaceProcedure } from "./workspace-procedure";
import { ConnectorInput } from "../../server/connectors/definition";
import {
  connectTools,
  listToolConnections,
  readToolConnection,
  remoteToolDefinition,
  revokeToolConnection,
} from "../../server/connectors/connections";
import { invokeRemoteTool } from "../../server/connectors/invocation";
import { decodeCustomerTool } from "../../server/workspaces/tool-document";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

const RemoteSelection = Schema.Struct({
  connectionId: Schema.String.check(Schema.isUUID()),
  revision: Schema.String.check(Schema.isUUID()),
  operation: Schema.String.check(Schema.isMaxLength(120)),
});
const selectionDefinition = Effect.fn("Connector.selection")(function* (
  actor: Parameters<typeof readToolConnection>[0],
  input: typeof RemoteSelection.Type
) {
  const connection = yield* readToolConnection(
    actor,
    input.connectionId,
    input.revision
  );
  const operation = connection.operations.find(
    (entry) => entry.id === input.operation
  );
  if (!operation) return yield* new WorkspaceAccessDenied();
  return yield* decodeCustomerTool(
    JSON.stringify(remoteToolDefinition(connection, operation))
  );
});

export const workspaceToolsRouter = {
  connections: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(listToolConnections(ctx.actor), { signal })
    ),
    connect: workspaceProcedure
      .input(Schema.toStandardSchemaV1(ConnectorInput))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(connectTools(ctx.actor, input), { signal })
      ),
    revoke: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ id: Schema.String.check(Schema.isUUID()) })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(revokeToolConnection(ctx.actor, input.id), {
          signal,
        })
      ),
    propose: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({
            ...RemoteSelection.fields,
            ...CustomerToolPublication.fields,
          })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          Effect.gen(function* () {
            const definition = yield* selectionDefinition(ctx.actor, input);
            return yield* (yield* WorkspaceRepository).write(ctx.actor, {
              ...input,
              path: `proposals/tools/${input.slug}.json`,
              content: JSON.stringify(definition, null, 2),
            });
          }),
          { signal }
        )
      ),
    test: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({
            ...RemoteSelection.fields,
            operationId: Schema.String.check(Schema.isUUID()),
            input: Schema.Record(Schema.String, Schema.Unknown),
          })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          Effect.gen(function* () {
            if (!ctx.actor.authSessionId)
              return yield* new WorkspaceAccessDenied();
            const definition = yield* selectionDefinition(ctx.actor, input);
            return yield* invokeRemoteTool(
              ctx.actor,
              definition,
              input.input,
              `test:${ctx.actor.userId}:${input.operationId}`
            );
          }),
          { signal }
        )
      ),
  },
  list: workspaceProcedure.query(({ ctx, signal }) =>
    serverRuntime.runPromise(listCustomerTools(ctx.actor), { signal })
  ),
  validate: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          content: Schema.String.check(Schema.isMaxLength(32_768)),
        })
      )
    )
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(validateCustomerTool(ctx.actor, input.content), {
        signal,
      })
    ),
  publish: workspaceProcedure
    .input(Schema.toStandardSchemaV1(CustomerToolPublication))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(publishCustomerTool(ctx.actor, input), {
        signal,
      })
    ),
  rollback: workspaceProcedure
    .input(Schema.toStandardSchemaV1(CustomerToolRollback))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(rollbackCustomerTool(ctx.actor, input), {
        signal,
      })
    ),
  disable: workspaceProcedure
    .input(Schema.toStandardSchemaV1(CustomerToolPublication))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(disableCustomerTool(ctx.actor, input), {
        signal,
      })
    ),
};
