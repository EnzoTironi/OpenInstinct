import { Effect, Schema } from "effect";
import type { SessionAuthContext } from "eve/context";
import { readProtocolTask } from "../a2a/tasks";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../workspaces/access";

/** Terminal A2A events still belong to the same authorized task; this grants no tool execution. */
export const telemetryScope = Effect.fn("telemetry.scope")(function* (
  principal: SessionAuthContext,
  sessionId: string
) {
  if (principal.authenticator !== "a2a")
    return yield* workspaceActorFromPrincipal(principal);
  const { protocolTaskId, ...attributes } = principal.attributes;
  if (!Schema.is(Schema.String.check(Schema.isUUID()))(protocolTaskId))
    return yield* new WorkspaceAccessDenied();
  const actor = yield* workspaceActorFromPrincipal({
    ...principal,
    attributes,
  });
  const task = yield* readProtocolTask(actor, protocolTaskId);
  if (
    task.state === "TASK_STATE_CANCELED" ||
    (task.sessionId !== null && task.sessionId !== sessionId)
  )
    return yield* new WorkspaceAccessDenied();
  return actor;
});
