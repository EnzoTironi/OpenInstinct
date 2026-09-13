import { createHash } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { A2AError, protocolTaskView, readProtocolTask } from "./tasks";

export const ListQuery = Schema.Struct({
  contextId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  status: Schema.optionalKey(
    Schema.Literals([
      "TASK_STATE_SUBMITTED",
      "TASK_STATE_WORKING",
      "TASK_STATE_COMPLETED",
      "TASK_STATE_FAILED",
      "TASK_STATE_CANCELED",
      "TASK_STATE_INPUT_REQUIRED",
    ])
  ),
  pageSize: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
  ),
  pageToken: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1024))),
  historyLength: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  statusTimestampAfter: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(64))
  ),
  includeArtifacts: Schema.optionalKey(Schema.Boolean),
});
const cursorSchema = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String.check(Schema.isUUID()),
    time: Schema.String,
    filter: Schema.String,
  })
);

export const listProtocolTasks = Effect.fn("listProtocolTasks")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof ListQuery.Type = {}
) {
  const query = yield* Schema.decodeUnknownEffect(ListQuery)(raw, {
    onExcessProperty: "error",
  });
  if (query.statusTimestampAfter)
    yield* Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(
      query.statusTimestampAfter
    );
  const filter = createHash("sha256")
    .update(
      JSON.stringify([
        actor.agentGrantId,
        query.contextId,
        query.status,
        query.statusTimestampAfter,
      ])
    )
    .digest("hex");
  const cursor = query.pageToken
    ? yield* Schema.decodeUnknownEffect(cursorSchema)(
        Buffer.from(query.pageToken, "base64url").toString("utf8")
      )
    : undefined;
  if (cursor) {
    yield* Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(
      cursor.time
    );
    if (cursor.filter !== filter)
      return yield* new A2AError({
        code: -32602,
        message: "Page token belongs to a different query",
      });
  }
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(actor);
      if (!actor.agentGrantId) return yield* new WorkspaceAccessDenied();
      const pageSize = query.pageSize ?? 50;
      const matches = sql`grant_id = ${actor.agentGrantId}
      AND (${query.contextId ?? null}::uuid IS NULL OR context_id = ${query.contextId ?? null}::uuid)
      AND (${query.status ?? null}::text IS NULL OR state = ${query.status ?? null})
      AND (${query.statusTimestampAfter ?? null}::timestamptz IS NULL OR updated_at >= ${query.statusTimestampAfter ?? null}::timestamptz)`;
      const count = yield* sql<{
        total: number;
      }>`SELECT count(*)::int AS total FROM agent_protocol_tasks WHERE ${matches}`;
      const rows = yield* sql<{ id: string; time: string }>`SELECT id,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time
      FROM agent_protocol_tasks WHERE ${matches}
      AND (${cursor?.id ?? null}::uuid IS NULL OR (updated_at, id) < (${cursor?.time ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY updated_at DESC, id DESC LIMIT ${pageSize + 1}`;
      const page = rows.slice(0, pageSize);
      const last = page.at(-1);
      return {
        tasks: yield* Effect.forEach(page, ({ id }) =>
          readProtocolTask(actor, id).pipe(
            Effect.map((task) =>
              protocolTaskView(task, query.includeArtifacts ?? false)
            )
          )
        ),
        pageSize,
        totalSize: count[0]?.total ?? 0,
        nextPageToken:
          rows.length > pageSize && last
            ? Buffer.from(JSON.stringify({ ...last, filter })).toString(
                "base64url"
              )
            : "",
      };
    })
  );
});
