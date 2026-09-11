import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";

import type { AccessScope } from "../../shared/identity/access-scope";
import { ChannelTransport } from "../channels/transport";

export class ScheduleOwnerInactive extends Schema.TaggedError<ScheduleOwnerInactive>()(
  "ScheduleOwnerInactive",
  {}
) {}

const requireScheduleMembership = Effect.fn("requireScheduleMembership")(
  function* (scope: AccessScope) {
    const sql = yield* PgClient.PgClient;

    const rows = yield* sql`SELECT user_id FROM workspace_memberships
      WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}
      FOR KEY SHARE`;

    if (!rows[0]) return yield* new ScheduleOwnerInactive();

    return undefined;
  }
);

export const requireScheduledChannelOwner = Effect.fn(
  "requireScheduledChannelOwner"
)(function* (job: {
  readonly conversationChannel: "telegram" | "kapso";
  readonly conversationId: string;
  readonly createdByUserId: string;
  readonly workspaceId: string;
}) {
  const transport = yield* ChannelTransport;

  const identity = yield* transport.activeIdentity(
    job.conversationId,
    job.conversationChannel
  );

  if (`better-auth:${identity.userId}` !== job.createdByUserId)
    return yield* new ScheduleOwnerInactive();
  yield* requireScheduleMembership({
    userId: job.createdByUserId,
    workspaceId: job.workspaceId,
  });

  return identity;
});
