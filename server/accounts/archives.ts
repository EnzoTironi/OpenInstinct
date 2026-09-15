import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { requireControlSession } from "./controls";
import { learnedNoteTypeId } from "../memory/learned-type";
import { LearnedMemoryItemSchema } from "../memory/learned";

const Id = Schema.String.check(Schema.isUUID());
const Cursor = Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/));
const FileCursor = Schema.String.check(Schema.isPattern(/^[0-9a-f-]{0,40}$/));
const Archive = Schema.Struct({
  id: Id,
  sourceUserId: Schema.String,
  workspaceId: Schema.String,
  createdAt: Schema.String,
});
class AccountArchiveMissing extends Schema.TaggedError<AccountArchiveMissing>()(
  "AccountArchiveMissing",
  {}
) {}

const ownedArchives = Effect.fn("ownedArchives")(function* (
  headers: Headers,
  id?: string
) {
  const session = yield* requireControlSession(headers);
  const sql = yield* PgClient.PgClient;
  if (id !== undefined) yield* Schema.decodeUnknownEffect(Id)(id);
  const rows =
    yield* sql`SELECT id, source_user_id AS "sourceUserId", workspace_id AS "workspaceId",
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM account_archive WHERE target_user_id = ${session.user.id}
    AND (${id === undefined} OR id = ${id ?? null}) ORDER BY created_at DESC`;
  return yield* Schema.decodeUnknownEffect(Schema.Array(Archive))(rows);
});

export const readAccountArchives = Effect.fn("readAccountArchives")(function* (
  headers: Headers
) {
  return (yield* ownedArchives(headers)).map(({ id, createdAt }) => ({
    id,
    createdAt,
  }));
});

export const readAccountArchive = Effect.fn("readAccountArchive")(function* (
  headers: Headers,
  id: string,
  after = "0",
  filesAfter = ""
) {
  const cursor = yield* Schema.decodeUnknownEffect(Cursor)(after);
  const fileCursor = yield* Schema.decodeUnknownEffect(FileCursor)(filesAfter);
  const archive = (yield* ownedArchives(headers, id))[0];
  if (!archive) return yield* new AccountArchiveMissing();
  const sql = yield* PgClient.PgClient;
  const messages = yield* sql<{
    cursor: string;
    direction: string;
    text: string;
    at: string;
  }>`
    SELECT cursor::text, direction, text, at::text FROM (
      SELECT row_number() OVER (ORDER BY at, id) AS cursor, direction, text, at FROM (
      SELECT q.id, 'inbound' AS direction,
        COALESCE(q.payload->>'text', '') AS text, q.received_at AS at
      FROM channel_inbox q JOIN channel_identity i ON i.id = q.identity_id WHERE i.user_id = ${archive.sourceUserId}
      UNION ALL SELECT q.id, 'outbound', COALESCE(q.payload->>'text', ''), q.created_at
      FROM channel_outbox q JOIN channel_identity i ON i.id = q.identity_id WHERE i.user_id = ${archive.sourceUserId}
    ) history) ordered WHERE cursor > ${cursor}::numeric ORDER BY cursor LIMIT 51`;
  const attachments = yield* sql<{
    id: string;
    filename: string;
    kind: "attachment" | "source";
  }>`SELECT id, filename, kind FROM (
    SELECT id::text, filename, 'attachment' AS kind FROM private_artifact
    WHERE workspace_id = ${archive.workspaceId} AND owner_user_id = ${`better-auth:${archive.sourceUserId}`} AND deleted_at IS NULL
    UNION ALL SELECT revision, filename, 'source' FROM workspace_source WHERE workspace_id = ${archive.workspaceId}
    ) files WHERE id > ${fileCursor} ORDER BY id LIMIT 51`;
  const repositories =
    yield* sql`SELECT head_sha FROM workspace_repository WHERE workspace_id = ${archive.workspaceId}`;
  return {
    id: archive.id,
    createdAt: archive.createdAt,
    messages: messages.slice(0, 50),
    next: messages.length > 50 ? messages[49]?.cursor : undefined,
    attachments: attachments.slice(0, 50),
    nextFile: attachments.length > 50 ? attachments[49]?.id : undefined,
    hasRepository: repositories.length === 1,
  };
});

export const downloadAccountArchive = Effect.fn("downloadAccountArchive")(
  function* (
    headers: Headers,
    id: string,
    section: "memory" | "files" | "attachment" | "source",
    attachmentId?: string
  ) {
    const archive = (yield* ownedArchives(headers, id))[0];
    if (!archive) return yield* new AccountArchiveMissing();
    const sql = yield* PgClient.PgClient;
    const responseHeaders = {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename="zoen-${archive.id}-${section}.${section === "memory" ? "json" : section === "files" ? "bundle" : "bin"}"`,
    };
    if (section === "files") {
      const files = yield* sql<{
        bundle: Uint8Array;
      }>`SELECT bundle FROM workspace_repository WHERE workspace_id = ${archive.workspaceId}`;
      if (!files[0]) return yield* new AccountArchiveMissing();
      return new Response(new Uint8Array(files[0].bundle), {
        headers: {
          ...responseHeaders,
          "content-type": "application/octet-stream",
        },
      });
    }
    if (section === "source") {
      const revision = yield* Schema.decodeUnknownEffect(
        Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/))
      )(attachmentId);
      const files = yield* sql<{
        content: Uint8Array;
      }>`SELECT content FROM workspace_source WHERE workspace_id = ${archive.workspaceId} AND revision = ${revision}`;
      if (!files[0]) return yield* new AccountArchiveMissing();
      return new Response(new Uint8Array(files[0].content), {
        headers: {
          ...responseHeaders,
          "content-type": "application/octet-stream",
        },
      });
    }
    if (section === "attachment") {
      const key = yield* Schema.decodeUnknownEffect(Id)(attachmentId);
      const files = yield* sql<{
        content: Uint8Array;
      }>`SELECT content FROM private_artifact
      WHERE id = ${key} AND workspace_id = ${archive.workspaceId} AND owner_user_id = ${`better-auth:${archive.sourceUserId}`} AND deleted_at IS NULL`;
      if (!files[0]) return yield* new AccountArchiveMissing();
      return new Response(new Uint8Array(files[0].content), {
        headers: {
          ...responseHeaders,
          "content-type": "application/octet-stream",
        },
      });
    }
    const profile =
      yield* sql`SELECT first_name, last_name, email, phone, date_of_birth, address_line_1,
    address_line_2, city, region, postal_code, country_code FROM user_profiles WHERE workspace_id = ${archive.workspaceId}`;
    const documents =
      yield* sql`SELECT d.content, d.updated_at FROM memory_document d
    JOIN personal_memory_binding b ON b.key = d.key WHERE b.workspace_id = ${archive.workspaceId}`;
    const namespaces = yield* sql<{
      id: string;
    }>`SELECT namespace_id AS id FROM workspace_memory_namespace
    WHERE workspace_id = ${archive.workspaceId} AND user_id = ${`better-auth:${archive.sourceUserId}`}`;
    const learned = yield* Effect.forEach(namespaces, (namespace) =>
      Effect.gen(function* () {
        const rows = yield* sql`SELECT id, memory,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
          FROM workspace_learned_item
          WHERE namespace_id = ${namespace.id} AND type_id = ${learnedNoteTypeId}
          ORDER BY updated_at DESC, id LIMIT 200`;
        return yield* Schema.decodeUnknownEffect(
          Schema.Array(LearnedMemoryItemSchema)
        )(rows);
      })
    );
    return Response.json(
      {
        profile: profile[0] ?? null,
        documents,
        learned: learned.flat(),
      },
      { headers: responseHeaders }
    );
  }
);
