import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  matrixConfiguration,
  matrixRequest,
  MatrixError,
  MatrixEventSchema,
} from "./client";

import { ensureMatrixIdentity, registerVirtualUser } from "./identities";

const roomResult = Schema.Struct({ room_id: Schema.String });
const roomSchema = Schema.Struct({
  id: Schema.String,
  roomId: Schema.String,
  label: Schema.String,
  epoch: Schema.String,
});
export const MatrixRoomInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
});
export const MatrixCreateInput = Schema.Struct({
  operationId: Schema.String.check(Schema.isUUID()),
  name: Schema.NonEmptyString.check(Schema.isTrimmed(), Schema.isMaxLength(80)),
});
export const MatrixMessageInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  operationId: Schema.String.check(Schema.isUUID()),
  text: Schema.NonEmptyString.check(
    Schema.isTrimmed(),
    Schema.isMaxLength(8000)
  ),
});

const requireMatrixRoom = Effect.fn("matrix.requireRoom")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string,
  manage = false
) {
  const access = yield* requireWorkspaceAccess(actor, manage);
  if (!actor.authSessionId || !access.organizationId)
    return yield* new WorkspaceAccessDenied();
  const config = yield* matrixConfiguration;
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT id, conversation_id AS "roomId", label, epoch FROM workspace_group_bindings
    WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND channel = 'matrix'
      AND installation_id = ${config.serverName} AND revoked_at IS NULL FOR SHARE`;
  if (rows.length !== 1) return yield* new WorkspaceAccessDenied();
  return yield* Schema.decodeUnknownEffect(roomSchema)(rows[0]);
});

export const listMatrixRooms = Effect.fn("matrix.listRooms")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const access = yield* requireWorkspaceAccess(actor);
  const configured = yield* matrixConfiguration.pipe(
    Effect.map(() => true),
    Effect.catchTag("MatrixError", () => Effect.succeed(false))
  );
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT id, conversation_id AS "roomId", label, epoch FROM workspace_group_bindings
    WHERE workspace_id = ${actor.workspaceId} AND channel = 'matrix' AND revoked_at IS NULL ORDER BY created_at`;
  return {
    configured,
    mayManage: !!access.organizationId && access.role !== "member",
    rooms: yield* Schema.decodeUnknownEffect(Schema.Array(roomSchema))(rows),
  };
});

export const createMatrixRoom = Effect.fn("matrix.createRoom")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  input: typeof MatrixCreateInput.Type
) {
  const access = yield* requireWorkspaceAccess(actor, true);
  if (!actor.authSessionId || !access.organizationId)
    return yield* new WorkspaceAccessDenied();
  const config = yield* matrixConfiguration;
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 4))`;
      yield* requireWorkspaceAccess(actor, true);
      const existing =
        yield* sql`SELECT id FROM workspace_group_bindings WHERE id = ${input.operationId}`;
      if (existing.length)
        return yield* requireMatrixRoom(actor, input.operationId);
      const rooms =
        yield* sql`SELECT id FROM workspace_group_bindings WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`;
      if (rooms.length >= 20)
        return yield* new MatrixError({ reason: "conflict" });
      yield* registerVirtualUser("_zoen_bot");
      const alias = `_zoen_room_${input.operationId}`;
      const response = yield* matrixRequest("POST", "createRoom", {
        name: input.name,
        room_alias_name: alias,
        preset: "private_chat",
        visibility: "private",
        creation_content: { "m.federate": false },
        initial_state: [
          {
            type: "m.room.history_visibility",
            state_key: "",
            content: { history_visibility: "joined" },
          },
        ],
        power_level_content_override: {
          users_default: 0,
          invite: 100,
          kick: 100,
          ban: 100,
          state_default: 100,
        },
      }).pipe(
        Effect.catchTag("MatrixError", (error) =>
          error.reason === "conflict"
            ? matrixRequest(
                "GET",
                `directory/room/${encodeURIComponent(`#${alias}:${config.serverName}`)}`
              )
            : Effect.fail(error)
        )
      );
      const room = yield* Schema.decodeUnknownEffect(roomResult)(response);
      yield* sql`INSERT INTO workspace_group_bindings(id, workspace_id, channel, installation_id, conversation_id, label, created_by)
      VALUES (${input.operationId}, ${actor.workspaceId}, 'matrix', ${config.serverName}, ${room.room_id}, ${input.name}, ${actor.userId})`;
      return yield* requireMatrixRoom(actor, input.operationId);
    })
  );
});

/** Access is checked again before every read/send. Virtual users receive no bearer tokens. */
const joinMatrixRoom = Effect.fn("matrix.joinRoom")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 5))`;
      const room = yield* requireMatrixRoom(actor, id);
      const matrixId = yield* ensureMatrixIdentity(actor);
      const members =
        yield* sql`SELECT user_id FROM matrix_room_members WHERE binding_id = ${id} AND user_id = ${actor.userId}`;
      if (!members.length) {
        const joined = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            joined: Schema.Record(Schema.String, Schema.Unknown),
          })
        )(
          yield* matrixRequest(
            "GET",
            `rooms/${encodeURIComponent(room.roomId)}/joined_members`
          )
        );
        if (!(matrixId in joined.joined)) {
          yield* matrixRequest(
            "POST",
            `rooms/${encodeURIComponent(room.roomId)}/invite`,
            { user_id: matrixId }
          );
          yield* matrixRequest(
            "POST",
            `join/${encodeURIComponent(room.roomId)}`,
            {},
            matrixId
          );
        }
        yield* sql`INSERT INTO matrix_room_members(binding_id, user_id) VALUES (${id}, ${actor.userId}) ON CONFLICT DO NOTHING`;
        yield* sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${id}`;
      }
      return { ...(yield* requireMatrixRoom(actor, id)), matrixId };
    })
  );
});

export const readMatrixMessages = Effect.fn("matrix.readMessages")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const room = yield* joinMatrixRoom(actor, id);
      yield* requireWorkspaceAccess(actor);
      const response = yield* matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=40&filter=${encodeURIComponent(JSON.stringify({ types: ["m.room.message"] }))}`,
        undefined,
        room.matrixId
      );
      const events = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ chunk: Schema.Array(MatrixEventSchema) })
      )(response);
      const people = yield* sql<{
        matrixId: string;
        name: string;
      }>`SELECT i.matrix_id AS "matrixId", COALESCE(d.username, u.name) AS name FROM matrix_identities i JOIN public.user u ON ('better-auth:' || u.id) = i.user_id LEFT JOIN user_directory d ON d.user_id = u.id JOIN matrix_room_members m ON m.user_id = i.user_id WHERE m.binding_id = ${id}`;
      yield* requireMatrixRoom(actor, id);
      const config = yield* matrixConfiguration;
      return {
        room,
        messages: events.chunk.toReversed().map((event) => ({
          id: event.event_id,
          text: event.content.body ?? "",
          sender:
            event.sender === config.botId
              ? "Zoen"
              : (people.find((p) => p.matrixId === event.sender)?.name ??
                "Matrix"),
          mine: event.sender === room.matrixId,
          timestamp: event.origin_server_ts ?? 0,
        })),
      };
    })
  );
});

export const sendMatrixMessage = Effect.fn("matrix.sendMessage")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  input: typeof MatrixMessageInput.Type
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const room = yield* joinMatrixRoom(actor, input.id);
      yield* requireWorkspaceAccess(actor);
      const sent = yield* matrixRequest(
        "PUT",
        `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${input.operationId}`,
        { msgtype: "m.text", body: input.text },
        room.matrixId
      );
      return yield* Schema.decodeUnknownEffect(
        Schema.Struct({ event_id: Schema.String })
      )(sent);
    })
  );
});

export const closeMatrixRoom = Effect.fn("matrix.closeRoom")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* requireMatrixRoom(actor, id, true);
      yield* sql`UPDATE workspace_group_bindings SET revoked_at = now(), epoch = ${randomUUID()} WHERE id = ${id} AND workspace_id = ${actor.workspaceId}`;
      return { closed: true };
    })
  );
});

/** Mirror live workspace revocation into Matrix; failed kicks remain retryable. */
export const reconcileMatrixRooms = Effect.fn("matrix.reconcileRooms")(
  function* () {
    const sql = yield* PgClient.PgClient;
    const stale = yield* sql<{
      bindingId: string;
      userId: string;
      matrixId: string;
      roomId: string;
    }>`
    SELECT m.binding_id AS "bindingId", m.user_id AS "userId", i.matrix_id AS "matrixId", b.conversation_id AS "roomId"
    FROM matrix_room_members m JOIN workspace_group_bindings b ON b.id = m.binding_id
    JOIN matrix_identities i ON i.user_id = m.user_id
    WHERE b.channel = 'matrix' AND (b.revoked_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM workspace_memberships w JOIN workspaces s ON s.id = w.workspace_id
      JOIN organization_memberships o ON o.organization_id = s.organization_id AND o.user_id = w.user_id
      WHERE w.workspace_id = b.workspace_id AND w.user_id = m.user_id
    )) LIMIT 50`;
    for (const member of stale) {
      yield* sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${member.bindingId}`;
      const joined = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ joined: Schema.Record(Schema.String, Schema.Unknown) })
      )(
        yield* matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(member.roomId)}/joined_members`
        )
      );
      if (member.matrixId in joined.joined)
        yield* matrixRequest(
          "POST",
          `rooms/${encodeURIComponent(member.roomId)}/kick`,
          { user_id: member.matrixId, reason: "Workspace access ended" }
        );
      yield* sql`DELETE FROM matrix_room_members WHERE binding_id = ${member.bindingId} AND user_id = ${member.userId}`;
    }
  }
);
