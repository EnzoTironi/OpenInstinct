import { createHash } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { openNetworkBot } from "../workspaces/network";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  matrixConfiguration,
  matrixRequest,
  MatrixEventSchema,
  MatrixError,
} from "./client";
import { ensureMatrixBot, ensureMatrixIdentity } from "./identities";

export const MatrixConversationInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
});
export const MatrixConversationSend = Schema.Struct({
  ...MatrixConversationInput.fields,
  operationId: Schema.String.check(Schema.isUUID()),
  text: Schema.NonEmptyString.check(
    Schema.isTrimmed(),
    Schema.isMaxLength(8000)
  ),
});
const conversationSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  requesterId: Schema.String,
  grantId: Schema.String,
  roomId: Schema.String,
  senderId: Schema.String,
  botId: Schema.String,
  username: Schema.String,
  name: Schema.String,
  description: Schema.String,
  destWorkspaceId: Schema.String,
  issuedBy: Schema.String,
  networkKind: Schema.Literals(["personal", "company"]),
});

/** The internal transport still checks the current source membership, network and destination grant. */
export const matrixConversationAuthority = Effect.fn(
  "matrix.conversationAuthority"
)(function* (id: string) {
  const sql = yield* PgClient.PgClient;
  const config = yield* matrixConfiguration;
  const rows =
    yield* sql`SELECT c.id, c.workspace_id AS "workspaceId", c.requester_id AS "requesterId",
    c.grant_id AS "grantId", c.room_id AS "roomId", c.sender_id AS "senderId", c.bot_id AS "botId",
    b.username, b.name, b.description, b.workspace_id AS "destWorkspaceId", g.issued_by AS "issuedBy", g.network_kind AS "networkKind"
    FROM matrix_agent_conversations c JOIN workspace_agent_grants g ON g.id = c.grant_id
    JOIN workspace_bots b ON b.id = g.bot_id
    WHERE c.id = ${id} AND c.closed_at IS NULL AND c.server_name = ${config.serverName}
      AND g.requester_user_id = c.requester_id AND g.source_workspace_id = c.workspace_id`;
  if (!rows[0]) return yield* new WorkspaceAccessDenied();
  const conversation = yield* Schema.decodeUnknownEffect(conversationSchema)(
    rows[0]
  );
  const destActor = {
    userId: conversation.issuedBy,
    workspaceId: conversation.destWorkspaceId,
    agentGrantId: conversation.grantId,
  };
  yield* requireWorkspaceAccess(destActor);
  const active =
    yield* sql`SELECT id FROM matrix_agent_conversations WHERE id = ${id} AND closed_at IS NULL FOR SHARE`;
  if (!active.length) return yield* new WorkspaceAccessDenied();
  return { ...conversation, destActor };
});

const userConversation = Effect.fn("matrix.userConversation")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
  yield* requireWorkspaceAccess(actor);
  const conversation = yield* matrixConversationAuthority(id);
  if (
    conversation.requesterId !== actor.userId ||
    conversation.workspaceId !== actor.workspaceId
  )
    return yield* new WorkspaceAccessDenied();
  return conversation;
});

export const openMatrixConversation = Effect.fn("matrix.openConversation")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    username: string,
    asAgent = false
  ) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const target = yield* openNetworkBot(actor, username, asAgent);
        const id = target.destActor.agentGrantId;
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 18))`;
        const existing =
          yield* sql`SELECT id FROM matrix_agent_conversations WHERE grant_id = ${id}`;
        if (existing.length) return yield* userConversation(actor, id);
        const config = yield* matrixConfiguration;
        const botId = yield* ensureMatrixBot(target.dest.id, target.dest.name);
        const senderId = target.source
          ? yield* ensureMatrixBot(target.source.id, target.source.name)
          : yield* ensureMatrixIdentity(actor);
        const alias = `_zoen_room_network_${id}`;
        const room = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ room_id: Schema.String })
        )(
          yield* matrixRequest(
            "POST",
            "createRoom",
            {
              room_alias_name: alias,
              name: target.dest.name,
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
            },
            botId
          ).pipe(
            Effect.catchTag("MatrixError", (error) =>
              error.reason === "conflict"
                ? matrixRequest(
                    "GET",
                    `directory/room/${encodeURIComponent(`#${alias}:${config.serverName}`)}`
                  )
                : Effect.fail(error)
            )
          )
        );
        const joined = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            joined: Schema.Record(Schema.String, Schema.Unknown),
          })
        )(
          yield* matrixRequest(
            "GET",
            `rooms/${encodeURIComponent(room.room_id)}/joined_members`,
            undefined,
            botId
          )
        );
        if (!(senderId in joined.joined)) {
          yield* matrixRequest(
            "POST",
            `rooms/${encodeURIComponent(room.room_id)}/invite`,
            { user_id: senderId },
            botId
          );
          yield* matrixRequest(
            "POST",
            `join/${encodeURIComponent(room.room_id)}`,
            {},
            senderId
          );
        }
        yield* requireWorkspaceAccess(actor);
        yield* requireWorkspaceAccess(target.destActor);
        yield* sql`INSERT INTO matrix_agent_conversations(id, workspace_id, requester_id, grant_id, room_id, server_name, sender_id, bot_id)
      VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${id}, ${room.room_id}, ${config.serverName}, ${senderId}, ${botId})`;
        return yield* userConversation(actor, id);
      })
    );
  },
  Effect.timeout("60 seconds")
);

export const listMatrixConversations = Effect.fn("matrix.listConversations")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
        yield* requireWorkspaceAccess(actor);
        const rows = yield* sql<{
          id: string;
        }>`SELECT id FROM matrix_agent_conversations
      WHERE workspace_id = ${actor.workspaceId} AND requester_id = ${actor.userId} AND closed_at IS NULL ORDER BY created_at DESC LIMIT 40`;
        return yield* Effect.forEach(rows, ({ id }) =>
          userConversation(actor, id).pipe(
            Effect.map((c) => ({
              id: c.id,
              username: c.username,
              name: c.name,
              network: c.networkKind,
            })),
            Effect.catchTag("WorkspaceAccessDenied", () => Effect.succeed(null))
          )
        ).pipe(Effect.map((items) => items.filter((item) => item !== null)));
      })
    );
  }
);

export const readMatrixConversation = Effect.fn("matrix.readConversation")(
  function* (actor: typeof WorkspaceActorSchema.Type, id: string) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const c = yield* userConversation(actor, id);
        const result = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ chunk: Schema.Array(MatrixEventSchema) })
        )(
          yield* matrixRequest(
            "GET",
            `rooms/${encodeURIComponent(c.roomId)}/messages?dir=b&limit=50`,
            undefined,
            c.senderId
          )
        );
        yield* userConversation(actor, id);
        return {
          id: c.id,
          name: c.name,
          username: c.username,
          network: c.networkKind,
          messages: result.chunk
            .filter(
              (event) =>
                event.type === "m.room.message" &&
                event.content.msgtype === "m.text" &&
                (event.sender === c.senderId || event.sender === c.botId)
            )
            .toReversed()
            .map((event) => ({
              id: event.event_id,
              text: event.content.body ?? "",
              fromBot: event.sender === c.botId,
              at: event.origin_server_ts,
            })),
        };
      })
    );
  }
);

export const sendMatrixConversation = Effect.fn("matrix.sendConversation")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof MatrixConversationSend.Type
  ) {
    const input = yield* Schema.decodeUnknownEffect(MatrixConversationSend)(
      raw
    );
    const sql = yield* PgClient.PgClient;
    const hash = createHash("sha256").update(input.text).digest("hex");
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* userConversation(actor, input.id);
        yield* sql`INSERT INTO matrix_agent_sends(conversation_id, operation_id, request_hash)
      VALUES (${input.id}, ${input.operationId}, ${hash}) ON CONFLICT DO NOTHING`;
        const rows = yield* sql<{
          request_hash: string;
        }>`SELECT request_hash FROM matrix_agent_sends WHERE conversation_id = ${input.id} AND operation_id = ${input.operationId}`;
        if (rows[0]?.request_hash !== hash)
          return yield* new MatrixError({ reason: "conflict" });
        return undefined;
      })
    );
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const c = yield* userConversation(actor, input.id);
        // Synapse owns deduplication for this identity/room/transaction. Only its
        // authenticated appservice event creates the A2A task, never this UI request.
        const result = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ event_id: Schema.String })
        )(
          yield* matrixRequest(
            "PUT",
            `rooms/${encodeURIComponent(c.roomId)}/send/m.room.message/zoen_${input.operationId}`,
            { msgtype: "m.text", body: input.text },
            c.senderId
          )
        );
        yield* sql`UPDATE matrix_agent_sends SET event_id = ${result.event_id} WHERE conversation_id = ${input.id} AND operation_id = ${input.operationId}`;
        return result;
      })
    );
  }
);

export const closeMatrixConversation = Effect.fn("matrix.closeConversation")(
  function* (actor: typeof WorkspaceActorSchema.Type, id: string) {
    const sql = yield* PgClient.PgClient;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 18))`;
        if (!actor.authSessionId) return yield* new WorkspaceAccessDenied();
        yield* requireWorkspaceAccess(actor);
        const closed = yield* sql`SELECT id FROM matrix_agent_conversations
          WHERE id = ${id} AND requester_id = ${actor.userId} AND workspace_id = ${actor.workspaceId} AND closed_at IS NOT NULL`;
        if (closed.length) return undefined;
        const c = yield* userConversation(actor, id);
        yield* sql`UPDATE workspace_agent_grants SET revoked_at = now() WHERE id = ${c.grantId}`;
        yield* sql`UPDATE matrix_agent_conversations SET closed_at = now() WHERE id = ${id} AND closed_at IS NULL`;
        yield* sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', output = NULL, updated_at = now()
      WHERE grant_id = ${c.grantId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`;
        return undefined;
      })
    );
  }
);
