import { readAgentGrantCapabilities } from "./bots";
import {
  ontologyPath,
  type OntologyActionSchema,
} from "@shared/workspaces/ontology";
import { createHash } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import {
  capabilitiesPath,
  WorkspaceCapabilitiesSchema,
} from "@shared/workspaces/capabilities";
import {
  GitRevisionSchema,
  publishWorkspaceGit,
  readWorkspaceGit,
  readWorkspaceGitSelection,
  searchWorkspaceGit,
  WorkspacePathSchema,
} from "./git";

export const WorkspaceWriteSchema = Schema.Struct({
  operationId: Schema.String.check(Schema.isUUID()),
  expectedRevision: Schema.NullOr(GitRevisionSchema),
  path: WorkspacePathSchema,
  content: Schema.NullOr(Schema.String.check(Schema.isMaxLength(262_144))),
});

class WorkspaceRepositoryError extends Schema.TaggedError<WorkspaceRepositoryError>()(
  "WorkspaceRepositoryError",
  {
    reason: Schema.Literals([
      "conflict",
      "not_found",
      "invalid_input",
      "unavailable",
    ]),
  }
) {}

const repositorySchema = Schema.Struct({
  head: GitRevisionSchema,
  bundle: Schema.Uint8Array,
});
const revisionSchema = Schema.Struct({
  revision: GitRevisionSchema,
  parent: Schema.NullOr(GitRevisionSchema),
  path: WorkspacePathSchema,
  author: Schema.String,
  createdAt: Schema.String,
  source: Schema.String,
});
const unavailable = () =>
  new WorkspaceRepositoryError({ reason: "unavailable" });
const importSourceSchema = Schema.Struct({
  filename: Schema.NonEmptyString.check(Schema.isMaxLength(255)),
  bytes: Schema.Uint8Array.check(Schema.isMaxLength(10_485_760)),
});

/** Shared executions never receive the owner's private profile or old versions. */
const visibleInSharedExecution = (path: string) =>
  path.startsWith("knowledge/") ||
  path.startsWith("ontology/") ||
  path.startsWith("skills/") ||
  [
    capabilitiesPath,
    "agent/SOUL.md",
    "agent/IDENTITY.md",
    "agent/AGENTS.md",
  ].includes(path);
const visibleToGrant = (path: string, grants: readonly string[] | null) =>
  grants === null ||
  path === capabilitiesPath ||
  (path.startsWith("ontology/")
    ? grants.includes("ontology")
    : grants.includes("files"));
const sharedExecution = (actor: typeof WorkspaceActorSchema.Type) =>
  !!(actor.agentGrantId ?? actor.groupBindingId);

const makeRepository = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const snapshot = Effect.fn("WorkspaceRepository.snapshot")(function* (
    workspaceId: string
  ) {
    const rows =
      yield* sql`SELECT head_sha AS head, bundle FROM workspace_repository WHERE workspace_id = ${workspaceId}`;
    return rows[0]
      ? yield* Schema.decodeUnknownEffect(repositorySchema)(rows[0])
      : null;
  });
  const replay = Effect.fn("WorkspaceRepository.replay")(function* (
    workspaceId: string,
    operationId: string,
    hash: string
  ) {
    const rows = yield* sql<{
      revision: string;
      request_hash: string;
    }>`SELECT revision, request_hash
      FROM workspace_revision WHERE workspace_id = ${workspaceId} AND operation_id = ${operationId}`;
    const previous = rows[0];
    if (previous && previous.request_hash !== hash)
      return yield* new WorkspaceRepositoryError({ reason: "conflict" });
    return previous?.revision ?? null;
  });

  return {
    selection: Effect.fn("WorkspaceRepository.selection")(
      function* (
        actor: typeof WorkspaceActorSchema.Type,
        paths: readonly string[]
      ) {
        yield* requireWorkspaceAccess(actor);
        const grants = actor.agentGrantId
          ? yield* readAgentGrantCapabilities(actor)
          : null;
        const stored = yield* snapshot(actor.workspaceId);
        if (!stored) return { revision: null, documents: [] };
        const listing = yield* readWorkspaceGit(stored.bundle, stored.head);
        const documents = yield* readWorkspaceGitSelection(
          stored.bundle,
          stored.head,
          paths.filter(
            (path) =>
              listing.files.includes(path) &&
              visibleToGrant(path, grants) &&
              (!sharedExecution(actor) || visibleInSharedExecution(path))
          )
        );
        return { revision: stored.head, documents };
      },
      sql.withTransaction,
      Effect.catchTag(["SqlError", "SchemaError"], unavailable)
    ),
    search: Effect.fn("WorkspaceRepository.search")(
      function* (actor: typeof WorkspaceActorSchema.Type, query: string) {
        yield* requireWorkspaceAccess(actor);
        const grants = actor.agentGrantId
          ? yield* readAgentGrantCapabilities(actor)
          : null;
        const stored = yield* snapshot(actor.workspaceId);
        if (!stored) return { revision: null, matches: [] };
        return {
          revision: stored.head,
          matches:
            grants !== null && !grants.includes("files")
              ? []
              : yield* searchWorkspaceGit(stored.bundle, stored.head, query),
        };
      },
      sql.withTransaction,
      Effect.catchTag(["SqlError", "SchemaError"], unavailable)
    ),
    read: Effect.fn("WorkspaceRepository.read")(
      function* (
        actor: typeof WorkspaceActorSchema.Type,
        path?: string,
        revision?: string
      ) {
        yield* requireWorkspaceAccess(actor);
        const grants = actor.agentGrantId
          ? yield* readAgentGrantCapabilities(actor)
          : null;
        const stored = yield* snapshot(actor.workspaceId);
        if (!stored) {
          const files: string[] = [];
          return { revision: null, content: null, files };
        }
        const sha = revision ?? stored.head;
        if (
          sharedExecution(actor) &&
          (sha !== stored.head ||
            (path !== undefined &&
              (!visibleInSharedExecution(path) ||
                !visibleToGrant(path, grants))))
        )
          return yield* new WorkspaceAccessDenied();
        const published = yield* sql`SELECT revision FROM workspace_revision
          WHERE workspace_id = ${actor.workspaceId} AND revision = ${sha}`;
        if (published.length !== 1)
          return yield* new WorkspaceRepositoryError({ reason: "not_found" });
        const listing = yield* readWorkspaceGit(stored.bundle, sha);
        if (path !== undefined && !listing.files.includes(path))
          return yield* new WorkspaceRepositoryError({ reason: "not_found" });
        const value =
          path === undefined
            ? listing
            : yield* readWorkspaceGit(stored.bundle, sha, path);
        return {
          revision: sha,
          ...value,
          files: value.files.filter(
            (filename) =>
              visibleToGrant(filename, grants) &&
              (!sharedExecution(actor) || visibleInSharedExecution(filename))
          ),
        };
      },
      sql.withTransaction,
      Effect.catchTag(["SqlError", "SchemaError"], unavailable)
    ),
    history: Effect.fn("WorkspaceRepository.history")(
      function* (actor: typeof WorkspaceActorSchema.Type, path: string) {
        if (sharedExecution(actor)) return yield* new WorkspaceAccessDenied();
        yield* requireWorkspaceAccess(actor);
        const filename =
          yield* Schema.decodeUnknownEffect(WorkspacePathSchema)(path);
        const rows =
          yield* sql`SELECT revision, parent_revision AS parent, path, author_user_id AS author,
          created_at::text AS "createdAt", source FROM workspace_revision
          WHERE workspace_id = ${actor.workspaceId} AND path = ${filename} ORDER BY created_at DESC, revision DESC LIMIT 50`;
        return yield* Schema.decodeUnknownEffect(Schema.Array(revisionSchema))(
          rows
        );
      },
      sql.withTransaction,
      Effect.catchTag(["SqlError", "SchemaError"], unavailable)
    ),
    export: Effect.fn("WorkspaceRepository.export")(
      function* (actor: typeof WorkspaceActorSchema.Type) {
        if (sharedExecution(actor)) return yield* new WorkspaceAccessDenied();
        yield* requireWorkspaceAccess(actor);
        return yield* snapshot(actor.workspaceId);
      },
      sql.withTransaction,
      Effect.catchTag(["SqlError", "SchemaError"], unavailable)
    ),
    source: Effect.fn("WorkspaceRepository.source")(
      function* (actor: typeof WorkspaceActorSchema.Type, revision: string) {
        if (sharedExecution(actor)) return yield* new WorkspaceAccessDenied();
        yield* requireWorkspaceAccess(actor);
        const sha =
          yield* Schema.decodeUnknownEffect(GitRevisionSchema)(revision);
        const rows =
          yield* sql`SELECT filename, content AS bytes FROM workspace_source
          WHERE workspace_id = ${actor.workspaceId} AND revision = ${sha}`;
        if (!rows[0])
          return yield* new WorkspaceRepositoryError({ reason: "not_found" });
        return yield* Schema.decodeUnknownEffect(importSourceSchema)(rows[0]);
      },
      sql.withTransaction,
      Effect.catchTag(["SqlError", "SchemaError"], unavailable)
    ),
    write: Effect.fn("WorkspaceRepository.write")(
      function* (
        actor: typeof WorkspaceActorSchema.Type,
        raw: typeof WorkspaceWriteSchema.Type,
        source:
          | { readonly kind: "editor" | "agent" }
          | {
              readonly kind: "ontology";
              readonly action?: Pick<
                typeof OntologyActionSchema.Type,
                "actionId" | "entityId"
              >;
            }
          | {
              readonly kind: "import";
              readonly filename: string;
              readonly bytes: Uint8Array;
            } = { kind: "editor" }
      ) {
        if (
          actor.agentGrantId ||
          (raw.path === ontologyPath && source.kind !== "ontology")
        )
          return yield* new WorkspaceAccessDenied();
        const input = yield* Schema.decodeUnknownEffect(WorkspaceWriteSchema)(
          raw
        ).pipe(
          Effect.mapError(
            () => new WorkspaceRepositoryError({ reason: "invalid_input" })
          )
        );
        if (input.path === capabilitiesPath && input.content !== null)
          yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(WorkspaceCapabilitiesSchema)
          )(input.content, { onExcessProperty: "error" });
        if (
          (input.path.startsWith("agent/") ||
            input.path.startsWith("skills/")) &&
          (input.content?.length ?? 0) > 16_000
        )
          return yield* new WorkspaceRepositoryError({
            reason: "invalid_input",
          });
        const original =
          source.kind === "import"
            ? yield* Schema.decodeUnknownEffect(importSourceSchema)(source)
            : null;
        const sourceSha =
          original === null
            ? null
            : createHash("sha256").update(original.bytes).digest("hex");
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              userId: actor.userId,
              input,
              source: {
                kind: source.kind,
                sha256: sourceSha,
                filename: original?.filename,
                action: source.kind === "ontology" ? source.action : undefined,
              },
            })
          )
          .digest("hex");
        const initial = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* requireWorkspaceAccess(
              actor,
              !input.path.startsWith("knowledge/")
            );
            const prior = yield* replay(
              actor.workspaceId,
              input.operationId,
              hash
            );
            return { prior, stored: yield* snapshot(actor.workspaceId) };
          })
        );
        if (initial.prior) return { revision: initial.prior };
        if ((initial.stored?.head ?? null) !== input.expectedRevision)
          return yield* new WorkspaceRepositoryError({ reason: "conflict" });
        const candidate = yield* publishWorkspaceGit({
          bundle: initial.stored?.bundle ?? null,
          parent: input.expectedRevision,
          path: input.path,
          content: input.content,
          message: `${input.content === null ? "Remove" : "Update"} ${input.path}\n\nZoen-Metadata: ${JSON.stringify({ actor: actor.userId, operation: input.operationId, action: source.kind === "ontology" ? source.action : undefined })}`,
        });
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* requireWorkspaceAccess(
              actor,
              !input.path.startsWith("knowledge/")
            );
            const prior = yield* replay(
              actor.workspaceId,
              input.operationId,
              hash
            );
            if (prior) return { revision: prior };
            const published =
              yield* sql`INSERT INTO workspace_repository (workspace_id, head_sha, bundle)
            VALUES (${actor.workspaceId}, ${candidate.revision}, ${candidate.bundle})
            ON CONFLICT (workspace_id) DO UPDATE SET head_sha = EXCLUDED.head_sha,
              bundle = EXCLUDED.bundle, updated_at = clock_timestamp()
              WHERE workspace_repository.head_sha = ${input.expectedRevision}
            RETURNING head_sha`;
            if (published.length !== 1) {
              const racedReplay = yield* replay(
                actor.workspaceId,
                input.operationId,
                hash
              );
              if (racedReplay) return { revision: racedReplay };
              return yield* new WorkspaceRepositoryError({
                reason: "conflict",
              });
            }
            yield* sql`INSERT INTO workspace_revision (workspace_id, revision, parent_revision, operation_id,
            request_hash, path, author_user_id, source, source_sha256)
            VALUES (${actor.workspaceId}, ${candidate.revision}, ${input.expectedRevision}, ${input.operationId},
              ${hash}, ${input.path}, ${actor.userId}, ${source.kind}, ${sourceSha})`;
            if (original !== null) {
              const totals = yield* sql<{
                bytes: number;
              }>`SELECT coalesce(sum(octet_length(content)), 0)::int AS bytes
              FROM workspace_source WHERE workspace_id = ${actor.workspaceId}`;
              if ((totals[0]?.bytes ?? 0) + original.bytes.length > 104_857_600)
                return yield* new WorkspaceRepositoryError({
                  reason: "invalid_input",
                });
              yield* sql`INSERT INTO workspace_source (workspace_id, revision, filename, content)
              VALUES (${actor.workspaceId}, ${candidate.revision}, ${original.filename}, ${original.bytes})`;
            }
            return { revision: candidate.revision };
          })
        );
      },
      Effect.catchTag(["SqlError", "SchemaError"], unavailable)
    ),
  };
});

export class WorkspaceRepository extends Context.Service<
  WorkspaceRepository,
  Effect.Success<typeof makeRepository>
>()("zoen/WorkspaceRepository") {
  static readonly layer = Layer.effect(WorkspaceRepository, makeRepository);
}
