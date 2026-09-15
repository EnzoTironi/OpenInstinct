import { createHash, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema, Semaphore } from "effect";
import {
  decodeCustomerValue,
  type CustomerToolSchema,
} from "../workspaces/tool-document";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { ConnectorError } from "./definition";
import { requireRemoteTool, toolConnectionCredentials } from "./connections";
import { invokeMcp } from "./mcp";
import { invokeOpenApi } from "./openapi";
import { redactConnectorCredential } from "./credentials";
const remoteSlots = Semaphore.makeUnsafe(8);

export const invokeRemoteTool = Effect.fn("Connector.invoke")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    definition: typeof CustomerToolSchema.Type,
    input: typeof CustomerToolSchema.Type.inputSchema,
    invocationKey: string
  ) {
    const { connection, operation } = yield* requireRemoteTool(
      actor,
      definition
    );
    const decoded = yield* decodeCustomerValue(operation.inputSchema, input);
    const token = yield* toolConnectionCredentials(
      actor,
      connection.id,
      connection.revision
    );
    const sql = yield* PgClient.PgClient;
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          userId: actor.userId,
          groupBindingId: actor.groupBindingId,
          connectionId: connection.id,
          revision: connection.revision,
          operation: operation.id,
          input: decoded,
        })
      )
      .digest("hex");
    const id = randomUUID();
    const claimed =
      yield* sql`INSERT INTO tool_invocations(id, workspace_id, connection_id, invocation_key, request_hash, status)
    VALUES (${id}, ${actor.workspaceId}, ${connection.id}, ${invocationKey}, ${requestHash}, 'started')
    ON CONFLICT (workspace_id, invocation_key) DO NOTHING RETURNING id`;
    if (!claimed.length) {
      const receipts =
        yield* sql`SELECT request_hash, status, result FROM tool_invocations WHERE workspace_id = ${actor.workspaceId} AND invocation_key = ${invocationKey}`;
      const receipt = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          request_hash: Schema.String,
          status: Schema.String,
          result: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
        })
      )(receipts[0]);
      if (receipt.request_hash !== requestHash)
        return yield* new ConnectorError({ reason: "changed" });
      if (receipt.status !== "completed" || !receipt.result)
        return yield* new ConnectorError({ reason: "uncertain" });
      yield* requireRemoteTool(actor, definition);
      return yield* decodeCustomerValue(
        operation.outputSchema,
        receipt.result,
        true
      );
    }
    // The durable claim is committed before HTTP. If a process dies or the
    // provider times out after writing, this key will never dispatch again.
    return yield* Effect.gen(function* () {
      yield* requireRemoteTool(actor, definition);
      const result =
        operation.request.kind === "mcp"
          ? yield* invokeMcp(
              connection.endpoint,
              token,
              operation,
              decoded,
              requireRemoteTool(actor, definition).pipe(Effect.asVoid)
            )
          : yield* invokeOpenApi(
              connection.endpoint,
              token,
              operation,
              decoded,
              id
            );
      const text = JSON.stringify(result);
      const clean = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
      )(redactConnectorCredential(text, token));
      const output = yield* decodeCustomerValue(
        operation.outputSchema,
        clean,
        true
      );
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* requireRemoteTool(actor, definition);
          const active =
            yield* sql`SELECT id FROM tool_connections WHERE id = ${connection.id} AND revision = ${connection.revision}
        AND revoked_at IS NULL FOR SHARE`;
          if (!active.length)
            return yield* new ConnectorError({ reason: "changed" });
          yield* sql`UPDATE tool_invocations SET result = ${JSON.stringify(output)}::jsonb, status = 'completed', completed_at = now()
        WHERE id = ${id} AND status = 'started'`;
          return undefined;
        })
      );
      return output;
    }).pipe(
      Effect.onError(() =>
        sql`UPDATE tool_invocations SET status = 'uncertain' WHERE id = ${id} AND status = 'started'`.pipe(
          Effect.orDie
        )
      ),
      Effect.catch(() => new ConnectorError({ reason: "uncertain" }))
    );
  },
  remoteSlots.withPermits(1),
  Effect.timeout("35 seconds")
);
