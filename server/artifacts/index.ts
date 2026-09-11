import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";

import { artifactAccess } from "./access";
import { artifactDigest, verifiedArtifact } from "./content";
import {
  ArtifactAccessSchema,
  ArtifactDeriveSchema,
  ArtifactError,
  ArtifactListSchema,
  ArtifactMetadataSchema,
  ArtifactPutSchema,
  ArtifactRowSchema,
  ArtifactSourceSchema,
  decodeArtifactInput,
  type ArtifactRow,
} from "./model";

const unavailable = () => new ArtifactError({ reason: "unavailable" });

const corrupt = () => new ArtifactError({ reason: "corrupt" });

const makeArtifacts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const { requireArtifactActor, readArtifactSource } = yield* artifactAccess;

  const metadataColumns = sql`a.id AS "artifactId", a.sha256, a.filename, a.media_type AS "mediaType",
    a.byte_length AS "byteLength", a.created_at::text AS "createdAt", a.source_event_id AS "sourceEventId",
    a.source_message_id AS "sourceMessageId", a.source_media_id AS "sourceMediaId"`;

  const rowColumns = sql`${metadataColumns}, a.owner_user_id AS "ownerUserId", a.workspace_id AS "workspaceId",
    a.source_identity_id AS "sourceIdentityId", a.source_inbox_id AS "sourceInboxId", a.content,
    a.derived_text AS "derivedText", a.derived_kind AS "derivedKind", a.deleted_at IS NOT NULL AS deleted`;

  const decodeRow = Schema.decodeUnknownEffect(ArtifactRowSchema);

  const requireRow = Effect.fn("Artifacts.requireRow")(function* (
    input: typeof ArtifactAccessSchema.Type,
    write: boolean
  ) {
    const scope = yield* requireArtifactActor(input.identityId);

    const rows = yield* sql`SELECT ${rowColumns} FROM private_artifact a
      WHERE a.id = ${input.artifactId} AND a.workspace_id = ${scope.workspaceId}
      AND a.owner_user_id = ${scope.userId} ${write ? sql`FOR UPDATE` : sql`FOR SHARE`}`;

    if (!rows[0]) return yield* new ArtifactError({ reason: "not_found" });

    return yield* decodeRow(rows[0]).pipe(Effect.mapError(corrupt));
  });

  const requireSourceOwner = Effect.fn("Artifacts.requireSourceOwner")(
    function* (row: ArtifactRow) {
      const sourceScope = yield* requireArtifactActor(row.sourceIdentityId);

      if (
        sourceScope.userId !== row.ownerUserId ||
        sourceScope.workspaceId !== row.workspaceId
      )
        return yield* new ArtifactError({ reason: "not_found" });

      return undefined;
    }
  );

  const findSource = Effect.fn("Artifacts.findSource")(function* (
    input: typeof ArtifactSourceSchema.Type
  ) {
    const scope = yield* requireArtifactActor(input.identityId);
    const source = yield* readArtifactSource(input);

    const rows = yield* sql`SELECT ${rowColumns} FROM private_artifact a
      WHERE a.source_identity_id = ${input.identityId} AND a.source_event_id = ${source.sourceEventId}
      AND a.source_media_id = ${source.sourceMediaId} FOR SHARE`;

    if (!rows[0]) return { scope, source, row: null };
    const row = yield* decodeRow(rows[0]).pipe(Effect.mapError(corrupt));

    if (
      row.ownerUserId !== scope.userId ||
      row.workspaceId !== scope.workspaceId ||
      row.sourceInboxId !== input.sourceInboxId ||
      row.sourceMessageId !== source.sourceMessageId ||
      row.filename !== source.filename ||
      row.mediaType !== source.mediaType
    )
      return yield* new ArtifactError({ reason: "source_conflict" });

    return { scope, source, row };
  });

  return {
    readForSource: Effect.fn("Artifacts.readForSource")(
      function* (input: typeof ArtifactSourceSchema.Type) {
        const value = yield* decodeArtifactInput(ArtifactSourceSchema, input);
        const stored = yield* findSource(value);

        return stored.row ? yield* verifiedArtifact(stored.row) : null;
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", unavailable),
      Effect.catchTag("SchemaError", corrupt)
    ),
    put: Effect.fn("Artifacts.put")(
      function* (input: typeof ArtifactPutSchema.Type) {
        const value = yield* decodeArtifactInput(ArtifactPutSchema, input);
        const bytes = Buffer.from(value.bytes);
        const sha256 = artifactDigest(bytes);
        const stored = yield* findSource(value);

        if (stored.row) {
          const existing = yield* verifiedArtifact(stored.row);

          if (
            existing.metadata.sha256 !== sha256 ||
            existing.metadata.byteLength !== bytes.length
          )
            return yield* new ArtifactError({ reason: "source_conflict" });

          return existing.metadata;
        }

        const { source, scope } = stored;
        yield* sql`INSERT INTO private_artifact
          (id, owner_user_id, workspace_id, source_identity_id, source_inbox_id, source_event_id,
           source_message_id, source_media_id, filename, media_type, byte_length, sha256, content)
          VALUES (${randomUUID()}, ${scope.userId}, ${scope.workspaceId}, ${value.identityId},
            ${value.sourceInboxId}, ${source.sourceEventId}, ${source.sourceMessageId}, ${source.sourceMediaId},
            ${source.filename}, ${source.mediaType}, ${bytes.length}, ${sha256}, ${bytes})
          ON CONFLICT (source_identity_id, source_event_id, source_media_id) DO NOTHING`;
        const current = yield* findSource(value);

        if (!current.row) return yield* unavailable();
        const saved = yield* verifiedArtifact(current.row);

        if (
          saved.metadata.sha256 !== sha256 ||
          saved.metadata.byteLength !== bytes.length
        )
          return yield* new ArtifactError({ reason: "source_conflict" });

        return saved.metadata;
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", unavailable),
      Effect.catchTag("SchemaError", corrupt)
    ),
    read: Effect.fn("Artifacts.read")(
      function* (input: typeof ArtifactAccessSchema.Type) {
        const value = yield* decodeArtifactInput(ArtifactAccessSchema, input);
        const row = yield* requireRow(value, false);
        yield* requireSourceOwner(row);

        return yield* verifiedArtifact(row);
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", unavailable),
      Effect.catchTag("SchemaError", corrupt)
    ),
    list: Effect.fn("Artifacts.list")(
      function* (input: typeof ArtifactListSchema.Type) {
        const value = yield* decodeArtifactInput(ArtifactListSchema, input);
        const scope = yield* requireArtifactActor(value.identityId);

        const rows =
          yield* sql`SELECT ${metadataColumns} FROM private_artifact a
          INNER JOIN channel_identity i ON i.id = a.source_identity_id AND i.revoked_at IS NULL
          WHERE a.workspace_id = ${scope.workspaceId} AND a.owner_user_id = ${scope.userId}
          AND ('better-auth:' || i.user_id) = ${scope.userId} AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC, a.id DESC LIMIT ${value.limit} FOR SHARE OF a, i`;

        return yield* Schema.decodeUnknownEffect(
          Schema.Array(ArtifactMetadataSchema)
        )(rows);
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", unavailable),
      Effect.catchTag("SchemaError", corrupt)
    ),
    setDerived: Effect.fn("Artifacts.setDerived")(
      function* (input: typeof ArtifactDeriveSchema.Type) {
        const value = yield* decodeArtifactInput(ArtifactDeriveSchema, input);
        const row = yield* requireRow(value, true);
        yield* requireSourceOwner(row);
        const existing = yield* verifiedArtifact(row);

        if (existing.metadata.sha256 !== value.sha256)
          return yield* new ArtifactError({ reason: "source_conflict" });
        yield* sql`UPDATE private_artifact SET derived_text = ${value.text}, derived_kind = ${value.kind},
          updated_at = clock_timestamp() WHERE id = ${value.artifactId} AND deleted_at IS NULL`;

        return existing.metadata;
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", unavailable),
      Effect.catchTag("SchemaError", corrupt)
    ),
    delete: Effect.fn("Artifacts.delete")(
      function* (input: typeof ArtifactAccessSchema.Type) {
        const value = yield* decodeArtifactInput(ArtifactAccessSchema, input);
        yield* requireRow(value, true);
        yield* sql`UPDATE private_artifact SET content = NULL, derived_text = NULL, derived_kind = NULL,
          deleted_at = COALESCE(deleted_at, clock_timestamp()), updated_at = clock_timestamp()
          WHERE id = ${value.artifactId} AND deleted_at IS NULL`;

        return { artifactId: value.artifactId, status: "deleted" as const };
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", unavailable),
      Effect.catchTag("SchemaError", corrupt)
    ),
  };
});

export class Artifacts extends Context.Service<
  Artifacts,
  Effect.Success<typeof makeArtifacts>
>()("companion/server/artifacts/Artifacts") {
  static readonly layer = Layer.effect(Artifacts, makeArtifacts);
}
