import { createHash, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

const identifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128)
);
export const A2AMessageSchema = Schema.Struct({
  message: Schema.Struct({
    messageId: identifier,
    role: Schema.Literal("ROLE_USER"),
    parts: Schema.Array(
      Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(8000)) })
    ).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
    contextId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
    taskId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  }),
  configuration: Schema.optionalKey(
    Schema.Struct({
      returnImmediately: Schema.optionalKey(Schema.Boolean),
      acceptedOutputModes: Schema.optionalKey(
        Schema.Array(Schema.Literal("text/plain"))
      ),
    })
  ),
});
const taskSchema = Schema.Struct({
  id: Schema.String,
  contextId: Schema.String,
  messageId: Schema.String,
  requestHash: Schema.String,
  prompt: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  state: Schema.String,
  output: Schema.NullOr(Schema.String),
  correlationId: Schema.String,
  round: Schema.Number,
  originTaskId: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export interface ProtocolTaskChain {
  correlationId: string;
  round: number;
  originTaskId: string;
}
export class A2AError extends Schema.TaggedError<A2AError>()("A2AError", {
  code: Schema.Number,
  message: Schema.String,
}) {}

export const readProtocolTask = Effect.fn("readProtocolTask")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  yield* requireWorkspaceAccess(actor);
  if (!actor.agentGrantId) return yield* new WorkspaceAccessDenied();
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT id, context_id AS "contextId", message_id AS "messageId", request_hash AS "requestHash", prompt, session_id AS "sessionId", state, output, correlation_id AS "correlationId", round, origin_task_id AS "originTaskId", updated_at::text AS "updatedAt"
    FROM agent_protocol_tasks WHERE id = ${id} AND grant_id = ${actor.agentGrantId}`;
  if (!rows[0])
    return yield* new A2AError({ code: -32001, message: "Task not found" });
  return yield* Schema.decodeUnknownEffect(taskSchema)(rows[0]);
});

export const acceptProtocolTask = Effect.fn("acceptProtocolTask")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof A2AMessageSchema.Type,
  chain?: ProtocolTaskChain
) {
  const input = yield* Schema.decodeUnknownEffect(A2AMessageSchema)(raw, {
    onExcessProperty: "error",
  });
  if (input.message.taskId)
    return yield* new A2AError({
      code: -32004,
      message:
        "Start a new task in the same context instead of reopening a terminal task",
    });
  const sql = yield* PgClient.PgClient;
  const hash = createHash("sha256")
    .update(JSON.stringify(input.message))
    .digest("hex");
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      // Serialize submissions before taking shared authority locks: two callers
      // must not both try to upgrade a shared grant lock to an exclusive lock.
      yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.agentGrantId ?? ""}, 2))`;
      yield* requireWorkspaceAccess(actor);
      if (!actor.agentGrantId) return yield* new WorkspaceAccessDenied();
      const previous = yield* sql<{
        id: string;
        request_hash: string;
      }>`SELECT id, request_hash FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId} AND message_id = ${input.message.messageId}`;
      if (previous[0]) {
        if (previous[0].request_hash !== hash)
          return yield* new A2AError({
            code: -32602,
            message: "Message ID was reused with different content",
          });
        return yield* readProtocolTask(actor, previous[0].id);
      }
      const recent = yield* sql<{
        active: number;
        recent: number;
      }>`SELECT count(*) FILTER (WHERE state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING'))::int AS active, count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS recent FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId}`;
      if ((recent[0]?.active ?? 0) >= 5 || (recent[0]?.recent ?? 0) >= 60)
        return yield* new A2AError({
          code: -32000,
          message: "Task limit reached; retry later",
        });
      if (input.message.contextId) {
        const context =
          yield* sql`SELECT id FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId} AND context_id = ${input.message.contextId} LIMIT 1`;
        if (!context.length)
          return yield* new A2AError({
            code: -32001,
            message: "Context not found",
          });
        const active =
          yield* sql`SELECT id FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId} AND context_id = ${input.message.contextId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING')`;
        if (active.length)
          return yield* new A2AError({
            code: -32000,
            message: "A task is already running in this context",
          });
      }
      const id = randomUUID();
      const round = chain?.round ?? 1;
      if (round < 1 || round > 8)
        return yield* new A2AError({
          code: -32000,
          message: "Task chain limit reached",
        });
      yield* sql`INSERT INTO agent_protocol_tasks(id, grant_id, context_id, message_id, request_hash, prompt, correlation_id, round, origin_task_id)
      VALUES (${id}, ${actor.agentGrantId}, ${input.message.contextId ?? randomUUID()}, ${input.message.messageId}, ${hash}, ${input.message.parts.map((part) => part.text).join("\n\n")}, ${chain?.correlationId ?? id}, ${round}, ${chain?.originTaskId ?? null})`;
      return yield* readProtocolTask(actor, id);
    })
  );
});

export const bindProtocolSession = Effect.fn("bindProtocolSession")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string,
  sessionId: string
) {
  yield* readProtocolTask(actor, id);
  const sql = yield* PgClient.PgClient;
  yield* sql`UPDATE agent_protocol_tasks SET session_id = ${sessionId}, state = CASE WHEN state = 'TASK_STATE_SUBMITTED' THEN 'TASK_STATE_WORKING' ELSE state END, updated_at = now()
    WHERE id = ${id} AND grant_id = ${actor.agentGrantId} AND (session_id IS NULL OR session_id = ${sessionId})`;
});

export const cancelProtocolTask = Effect.fn("cancelProtocolTask")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* readProtocolTask(actor, id);
      // Persist cancellation before delivering it. A racing dispatch or tool call
      // then fails the same live authority check, even if no session is bound yet.
      const changed =
        yield* sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', updated_at = now()
      WHERE id = ${id} AND grant_id = ${actor.agentGrantId}
      AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_CANCELED') RETURNING id`;
      if (!changed.length)
        return yield* new A2AError({
          code: -32002,
          message: "Task cannot be canceled",
        });
      return yield* readProtocolTask(actor, id);
    })
  );
});

export const awaitProtocolTask = Effect.fn("awaitProtocolTask")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  for (;;) {
    const task = yield* readProtocolTask(actor, id);
    if (
      task.state !== "TASK_STATE_SUBMITTED" &&
      task.state !== "TASK_STATE_WORKING"
    )
      return task;
    yield* Effect.sleep("500 millis");
  }
});

export const finishProtocolTask = Effect.fn("finishProtocolTask")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string,
  state: "TASK_STATE_COMPLETED" | "TASK_STATE_FAILED" | "TASK_STATE_CANCELED",
  output?: string
) {
  yield* readProtocolTask(actor, id);
  const sql = yield* PgClient.PgClient;
  yield* sql`UPDATE agent_protocol_tasks SET state = ${state}, output = ${output?.slice(0, 32000) ?? null}, updated_at = now()
    WHERE id = ${id} AND grant_id = ${actor.agentGrantId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`;
});

export function protocolTaskView(
  task: typeof taskSchema.Type,
  includeArtifacts = true
) {
  const message = task.output
    ? {
        messageId: `${task.id}:result`,
        contextId: task.contextId,
        taskId: task.id,
        role: "ROLE_AGENT",
        parts: [{ text: task.output }],
      }
    : undefined;
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.state,
      timestamp: new Date(task.updatedAt).toISOString(),
      message,
    },
    artifacts: includeArtifacts
      ? task.state === "TASK_STATE_COMPLETED" && task.output
        ? [{ artifactId: `${task.id}:answer`, parts: [{ text: task.output }] }]
        : []
      : undefined,
  };
}

/** Native failure events can arrive before the acceptance receipt is bound. */
export const failProtocolSession = Effect.fn("failProtocolSession")(function* (
  sessionId: string,
  continuation: string | undefined
) {
  const parts = continuation?.split(":");
  if (
    parts?.length !== 3 ||
    parts[0] !== "a2a" ||
    !Schema.is(Schema.String.check(Schema.isUUID()))(parts[1]) ||
    !Schema.is(Schema.String.check(Schema.isUUID()))(parts[2])
  )
    return;
  const sql = yield* PgClient.PgClient;
  yield* sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_FAILED', session_id = ${sessionId},
    output = 'The task could not be completed. Start a new task to retry.', updated_at = now()
    WHERE id = ${parts[2]} AND grant_id = ${parts[1]} AND (session_id IS NULL OR session_id = ${sessionId})
      AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING')`;
});
