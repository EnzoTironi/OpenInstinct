import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { ChannelReceiveContext } from "eve/channels";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { A2AError, bindProtocolSession, readProtocolTask } from "./tasks";

export const deliverProtocolTask = Effect.fn("deliverProtocolTask")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  taskId: string,
  channel: Pick<ChannelReceiveContext, "from" | "attachSession">
) {
  if (!actor.agentGrantId) return yield* new WorkspaceAccessDenied();
  const access = yield* requireWorkspaceAccess({
    ...actor,
    protocolTaskId: taskId,
  });
  const task = yield* readProtocolTask(actor, taskId);
  const auth = {
    principalType: "user" as const,
    principalId: actor.userId,
    authenticator: "a2a",
    attributes: {
      workspaceId: actor.workspaceId,
      workspaceKind: access.organizationId === null ? "personal" : "company",
      agentGrantId: actor.agentGrantId ?? "",
      protocolTaskId: task.id,
      conversationChannel: "a2a",
    },
  };
  // Each task has a fixed session; contextId only groups tasks and grants no access.
  const source = channel.from(`a2a:${actor.agentGrantId}:${task.id}`);
  const session = yield* Effect.tryPromise({
    try: async () => {
      const receipt = await source.getInputAcceptance(task.id, auth);
      if (receipt) {
        const recovered = await source.recoverInputAcceptance(task.id, auth);
        if (!recovered || recovered.sessionId !== receipt.sessionId)
          throw new Error("Native input recovery did not match");
        return channel.attachSession(receipt.sessionId);
      }
      const accepted = await source.send(task.prompt, {
        auth,
        inputId: task.id,
        turnPolicy: "queue",
        title: "Agent collaboration",
      });
      return channel.attachSession(
        accepted.acceptedInput?.sessionId ?? accepted.id
      );
    },
    catch: () =>
      new A2AError({
        code: -32603,
        message: "Task was accepted; retry with the same message ID",
      }),
  });
  yield* bindProtocolSession(actor, task.id, session.id);
  const current = yield* readProtocolTask(actor, task.id);
  if (current.state === "TASK_STATE_CANCELED")
    yield* Effect.tryPromise(() => session.cancel());
  return session;
});

/** Only native scheduled dispatch uses this lookup; HTTP always verifies a bearer. */
export const recoverableProtocolActor = Effect.fn("recoverableProtocolActor")(
  function* (taskId: string) {
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql<{
      userId: string;
      workspaceId: string;
      agentGrantId: string;
    }>`
    SELECT g.issued_by AS "userId", b.workspace_id AS "workspaceId", g.id AS "agentGrantId"
    FROM agent_protocol_tasks t JOIN workspace_agent_grants g ON g.id = t.grant_id
    JOIN workspace_bots b ON b.id = g.bot_id WHERE t.id = ${taskId} AND t.state = 'TASK_STATE_SUBMITTED'`;
    if (!rows[0]) return yield* new WorkspaceAccessDenied();
    return yield* requireWorkspaceAccess(rows[0]);
  }
);

export const listPendingProtocolTasks = Effect.fn("listPendingProtocolTasks")(
  function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql<{ id: string }>`SELECT t.id FROM agent_protocol_tasks t
    JOIN workspace_agent_grants g ON g.id = t.grant_id
    WHERE t.state = 'TASK_STATE_SUBMITTED' AND t.created_at < now() - interval '10 seconds'
    AND g.revoked_at IS NULL AND g.expires_at > now() ORDER BY t.created_at LIMIT 25`;
  }
);
