import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import { readProtocolTask } from "../a2a/tasks";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { matrixConversationAuthority } from "./conversations";

/** Receipt lookup is scoped to the current human and source workspace, never just an event ID. */
export const readMatrixResult = Effect.fn("matrix.readResult")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  conversationId: string,
  eventId: string
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
      yield* requireWorkspaceAccess(actor);
      const c = yield* matrixConversationAuthority(conversationId);
      if (c.requesterId !== actor.userId || c.workspaceId !== actor.workspaceId)
        return yield* new WorkspaceAccessDenied();
      const sent = yield* sql`SELECT 1 FROM matrix_agent_sends
      WHERE conversation_id = ${conversationId} AND event_id = ${eventId}`;
      if (!sent.length) return yield* new WorkspaceAccessDenied();
      const rows = yield* sql<{
        task_id: string;
      }>`SELECT task_id FROM matrix_agent_messages
      WHERE conversation_id = ${conversationId} AND event_id = ${eventId}`;
      const task = rows[0]
        ? yield* readProtocolTask(c.destActor, rows[0].task_id)
        : null;
      return {
        conversationId,
        eventId,
        bot: c.username,
        state: task?.state ?? "TASK_STATE_SUBMITTED",
        taskId: task?.id ?? null,
        // A terminal cancelled task must not leak an earlier partial output.
        text: task?.state === "TASK_STATE_COMPLETED" ? task.output : null,
      };
    })
  );
});

export const awaitMatrixResult = Effect.fn("matrix.awaitResult")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  conversationId: string,
  eventId: string
) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = yield* readMatrixResult(actor, conversationId, eventId);
    if (!["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(result.state))
      return result;
    yield* Effect.sleep("500 millis");
  }
  return yield* readMatrixResult(actor, conversationId, eventId);
});
