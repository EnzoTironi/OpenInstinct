import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { ChannelReceiveContext } from "eve/channels";
import { WorkspaceAccessDenied } from "../workspaces/access";

export const pendingProtocolCancellations = Effect.fn(
  "a2a.pendingCancellations"
)(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql<{
    session_id: string;
  }>`SELECT session_id FROM agent_protocol_cancellations
    ORDER BY requested_at LIMIT 25`;
});

/** Called only by the authenticated native scheduler; the persisted outbox is the authority. */
export const deliverProtocolCancellation = Effect.fn("a2a.deliverCancellation")(
  function* (
    sessionId: string,
    channel: Pick<ChannelReceiveContext, "attachSession">
  ) {
    const sql = yield* PgClient.PgClient;
    const queued =
      yield* sql`SELECT 1 FROM agent_protocol_cancellations WHERE session_id = ${sessionId}`;
    if (!queued.length) return yield* new WorkspaceAccessDenied();
    yield* Effect.tryPromise({
      try: () => channel.attachSession(sessionId).cancel({ tasks: true }),
      catch: () => new Error("Native task cancellation remains pending"),
    });
    yield* sql`DELETE FROM agent_protocol_cancellations WHERE session_id = ${sessionId}`;
    return undefined;
  }
);
