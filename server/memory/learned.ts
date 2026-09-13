import { PgClient } from "@effect/sql-pg";
import { createHash } from "node:crypto";
import { Context, Effect, Layer, Schema } from "effect";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { LearnedMemoryItemSchema, Mem0 } from "./mem0";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";

const namespaceSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  enabled: Schema.Boolean,
  scopeKey: Schema.NullOr(Schema.String),
  pendingOperation: Schema.NullOr(Schema.String),
  pendingHash: Schema.NullOr(Schema.String),
});
const snapshotSchema = Schema.Struct({
  enabled: Schema.Boolean,
  results: Schema.Array(LearnedMemoryItemSchema),
});
export const LearnedMemoryWriteSchema = Schema.Struct({
  action: Schema.Literals(["remember", "update", "delete", "clear"]),
  operationId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  text: Schema.optionalKey(
    Schema.NonEmptyString.check(Schema.isMaxLength(8000))
  ),
  memoryId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
});

class LearnedMemoryError extends Schema.TaggedError<LearnedMemoryError>()(
  "LearnedMemoryError",
  {
    reason: Schema.Literals([
      "disabled",
      "invalid_input",
      "unavailable",
      "stale_recall",
    ]),
  }
) {}

const makeLearnedMemory = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const mem0 = yield* Mem0;
  const namespace = Effect.fn("LearnedMemory.namespace")(function* (
    actor: typeof WorkspaceActorSchema.Type,
    scopeKey?: string
  ) {
    yield* requireWorkspaceAccess(actor);
    yield* sql`INSERT INTO workspace_memory_namespace (workspace_id, user_id) VALUES (${actor.workspaceId}, ${actor.userId}) ON CONFLICT DO NOTHING`;
    const rows =
      yield* sql`SELECT namespace_id AS id, enabled, eve_scope_key AS "scopeKey",
      pending_operation AS "pendingOperation", pending_hash AS "pendingHash" FROM workspace_memory_namespace
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} FOR UPDATE`;
    const partition = yield* Schema.decodeUnknownEffect(namespaceSchema)(
      rows[0]
    );
    if (scopeKey !== undefined) {
      if (
        !scopeKey ||
        scopeKey.length > 1024 ||
        (partition.scopeKey !== null && partition.scopeKey !== scopeKey)
      )
        return yield* new LearnedMemoryError({ reason: "invalid_input" });
      if (partition.scopeKey === null)
        yield* sql`UPDATE workspace_memory_namespace SET eve_scope_key = ${scopeKey} WHERE namespace_id = ${partition.id}`;
    }
    const capabilities = yield* readWorkspaceCapabilities(actor);
    return {
      ...partition,
      workspaceEnabled: capabilities.enabled.includes("memory"),
      enabled: partition.enabled && capabilities.enabled.includes("memory"),
    };
  });
  return {
    recall: Effect.fn("LearnedMemory.recall")(
      function* (
        actor: typeof WorkspaceActorSchema.Type,
        scopeKey: string,
        operationId: string,
        query: string
      ) {
        const partition = yield* namespace(actor, scopeKey);
        if (partition.enabled && partition.pendingOperation !== null)
          return yield* new LearnedMemoryError({ reason: "stale_recall" });
        const previous = yield* sql<{
          snapshot: unknown;
        }>`SELECT snapshot FROM workspace_memory_recall
          WHERE namespace_id = ${partition.id} AND operation_id = ${operationId}`;
        if (previous[0]) {
          if (previous[0].snapshot === null)
            return yield* new LearnedMemoryError({ reason: "stale_recall" });
          return yield* Schema.decodeUnknownEffect(snapshotSchema)(
            previous[0].snapshot
          );
        }
        const result = partition.enabled
          ? yield* mem0.read(partition.id, query.slice(0, 8000) || undefined)
          : { results: [] };
        const value = { enabled: partition.enabled, results: result.results };
        yield* sql`INSERT INTO workspace_memory_recall (namespace_id, operation_id, snapshot)
          VALUES (${partition.id}, ${operationId}, ${sql.json(value)})`;
        // Keep only receipts for older operations; replay must never silently fetch newer facts.
        yield* sql`UPDATE workspace_memory_recall SET snapshot = NULL
          WHERE namespace_id = ${partition.id} AND created_at < now() - interval '7 days' AND snapshot IS NOT NULL`;
        return value;
      },
      sql.withTransaction,
      Effect.catchTag(
        ["SqlError", "SchemaError"],
        () => new LearnedMemoryError({ reason: "unavailable" })
      )
    ),
    read: Effect.fn("LearnedMemory.read")(
      function* (
        actor: typeof WorkspaceActorSchema.Type,
        query?: string,
        includePaused = false
      ) {
        const partition = yield* namespace(actor);
        if (!partition.enabled && !includePaused)
          return {
            enabled: false,
            workspaceEnabled: partition.workspaceEnabled,
            results: [],
            needsAttention: partition.pendingOperation !== null,
          };
        const result = yield* mem0.read(partition.id, query?.slice(0, 8000));
        return {
          enabled: partition.enabled,
          workspaceEnabled: partition.workspaceEnabled,
          results: result.results,
          needsAttention: partition.pendingOperation !== null,
        };
      },
      sql.withTransaction,
      Effect.catchTag(
        ["SqlError", "SchemaError"],
        () => new LearnedMemoryError({ reason: "unavailable" })
      )
    ),
    write: Effect.fn("LearnedMemory.write")(
      function* (
        actor: typeof WorkspaceActorSchema.Type,
        raw: typeof LearnedMemoryWriteSchema.Type,
        inferInput?: boolean
      ) {
        const infer = inferInput ?? true;
        const input = yield* Schema.decodeUnknownEffect(
          LearnedMemoryWriteSchema
        )(raw).pipe(
          Effect.mapError(
            () => new LearnedMemoryError({ reason: "invalid_input" })
          )
        );
        if (
          (input.action === "remember" || input.action === "update") &&
          !input.text
        )
          return yield* new LearnedMemoryError({ reason: "invalid_input" });
        if (
          (input.action === "update" || input.action === "delete") &&
          !input.memoryId
        )
          return yield* new LearnedMemoryError({ reason: "invalid_input" });
        const hash = createHash("sha256")
          .update(JSON.stringify({ input, infer }))
          .digest("hex");
        // Fence recall durably BEFORE crossing the service boundary. A timeout or
        // database rollback after Mem0 accepts a deletion cannot expose old notes.
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const partition = yield* namespace(actor);
            if (!partition.enabled && input.action === "remember")
              return yield* new LearnedMemoryError({ reason: "disabled" });
            if (
              partition.pendingOperation !== null &&
              input.action !== "clear" &&
              (partition.pendingOperation !== input.operationId ||
                partition.pendingHash !== hash)
            )
              return yield* new LearnedMemoryError({ reason: "stale_recall" });
            yield* sql`UPDATE workspace_memory_namespace SET pending_operation = ${input.operationId}, pending_hash = ${hash} WHERE namespace_id = ${partition.id}`;
            yield* sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`;
            return undefined;
          })
        );
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const partition = yield* namespace(actor);
            if (
              partition.pendingOperation !== input.operationId ||
              partition.pendingHash !== hash
            )
              return yield* new LearnedMemoryError({ reason: "stale_recall" });
            const result = yield* mem0.mutate({
              namespace: partition.id,
              action: input.action,
              operation_id: input.operationId,
              text: input.text,
              memory_id: input.memoryId,
              infer,
            });
            yield* sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`;
            yield* sql`UPDATE workspace_memory_namespace SET pending_operation = NULL, pending_hash = NULL WHERE namespace_id = ${partition.id}`;
            return result;
          })
        );
      },
      Effect.catchTag(
        ["SqlError", "SchemaError"],
        () => new LearnedMemoryError({ reason: "unavailable" })
      )
    ),
    recover: Effect.fn("LearnedMemory.recover")(function* (
      actor: typeof WorkspaceActorSchema.Type
    ) {
      const partition = yield* namespace(actor);
      // A fresh, successful service read completes before recall is unfenced.
      // Old operation receipts remain tombstoned; recovery never replays writes.
      yield* mem0.read(partition.id);
      yield* sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`;
      yield* sql`UPDATE workspace_memory_namespace SET pending_operation = NULL, pending_hash = NULL WHERE namespace_id = ${partition.id}`;
      return { recovered: true };
    }, sql.withTransaction),
    setEnabled: Effect.fn("LearnedMemory.setEnabled")(
      function* (actor: typeof WorkspaceActorSchema.Type, enabled: boolean) {
        const partition = yield* namespace(actor);
        yield* sql`UPDATE workspace_memory_namespace SET enabled = ${enabled}
          WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`;
        yield* sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`;
        return { enabled };
      },
      sql.withTransaction,
      Effect.catchTag(
        ["SqlError", "SchemaError"],
        () => new LearnedMemoryError({ reason: "unavailable" })
      )
    ),
  };
});

export class LearnedMemory extends Context.Service<
  LearnedMemory,
  Effect.Success<typeof makeLearnedMemory>
>()("zoen/LearnedMemory") {
  static readonly layer = Layer.effect(LearnedMemory, makeLearnedMemory);
}
