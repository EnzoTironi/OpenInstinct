import { createHash } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { matrixConfiguration, matrixRequest } from "./client";

export const registerVirtualUser = Effect.fn("matrix.registerVirtualUser")(
  function* (localpart: string) {
    yield* matrixRequest("POST", "register", {
      type: "m.login.application_service",
      username: localpart,
      inhibit_login: true,
    }).pipe(
      Effect.catchTag("MatrixError", (error) =>
        error.reason === "conflict" ? Effect.void : Effect.fail(error)
      )
    );
  }
);

export const ensureMatrixIdentity = Effect.fn("matrix.ensureIdentity")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const config = yield* matrixConfiguration;
    const sql = yield* PgClient.PgClient;
    const localpart = `_zoen_${createHash("sha256").update(actor.userId).digest("hex").slice(0, 32)}`;
    const matrixId = `@${localpart}:${config.serverName}`;
    const existing = yield* sql<{
      displayName: string;
    }>`SELECT display_name AS "displayName" FROM matrix_identities WHERE user_id = ${actor.userId} AND matrix_id = ${matrixId}`;
    if (!existing.length) {
      yield* registerVirtualUser(localpart);
      yield* sql`INSERT INTO matrix_identities(user_id, matrix_id) VALUES (${actor.userId}, ${matrixId}) ON CONFLICT DO NOTHING`;
    }
    const names = yield* sql<{
      name: string;
    }>`SELECT COALESCE(d.username, u.name) AS name FROM public.user u LEFT JOIN user_directory d ON d.user_id = u.id WHERE ('better-auth:' || u.id) = ${actor.userId}`;
    if (names[0] && names[0].name !== existing[0]?.displayName) {
      yield* matrixRequest(
        "PUT",
        `profile/${encodeURIComponent(matrixId)}/displayname`,
        { displayname: names[0].name },
        matrixId
      );
      yield* sql`UPDATE matrix_identities SET display_name = ${names[0].name} WHERE user_id = ${actor.userId}`;
    }
    return matrixId;
  }
);

export const ensureMatrixBot = Effect.fn("matrix.ensureBot")(function* (
  id: string,
  name: string
) {
  const config = yield* matrixConfiguration;
  const localpart = `_zoen_agent_${id.replaceAll("-", "")}`;
  const matrixId = `@${localpart}:${config.serverName}`;
  yield* registerVirtualUser(localpart);
  yield* matrixRequest(
    "PUT",
    `profile/${encodeURIComponent(matrixId)}/displayname`,
    { displayname: name },
    matrixId
  );
  return matrixId;
});
