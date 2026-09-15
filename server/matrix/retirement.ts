import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import { matrixConfiguration, matrixRequest } from "./client";

/** Current application access is already denied; this outbox also removes homeserver membership. */
export const retireMatrixRooms = Effect.fn("matrix.retireRooms")(function* () {
  const sql = yield* PgClient.PgClient;
  const config = yield* matrixConfiguration;
  // Expiry or unpublishing must also retire rooms without waiting for another user request.
  yield* sql`UPDATE matrix_agent_conversations c SET closed_at = now()
    FROM workspace_agent_grants g JOIN workspace_bots b ON b.id = g.bot_id
    WHERE c.grant_id = g.id AND c.closed_at IS NULL
      AND (g.revoked_at IS NOT NULL OR g.expires_at <= now() OR NOT b.discoverable)`;
  const rows = yield* sql<{
    room_id: string;
    sender_id: string;
    bot_id: string;
  }>`
    SELECT room_id, sender_id, bot_id FROM matrix_room_retirements
    WHERE server_name = ${config.serverName} ORDER BY requested_at LIMIT 25`;
  yield* Effect.forEach(
    rows,
    (row) =>
      Effect.gen(function* () {
        // Each identity voluntarily leaves: replay is idempotent even after the bot has left.
        for (const identity of [row.sender_id, row.bot_id]) {
          yield* matrixRequest(
            "POST",
            `rooms/${encodeURIComponent(row.room_id)}/leave`,
            {},
            identity
          );
        }
        yield* sql`DELETE FROM matrix_room_retirements WHERE room_id = ${row.room_id} AND server_name = ${config.serverName}`;
      }).pipe(
        Effect.catch(() =>
          Effect.logWarning("Matrix membership retirement remains pending")
        )
      ),
    { concurrency: 2 }
  );
});
