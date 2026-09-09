import { PgClient } from "@effect/sql-pg";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import type { MemoryOperationContext } from "eve/memory";
import { readUserProfile } from "@db/services/user-profile";
import type { AccessScope } from "@shared/identity/access-scope";
import { storedNoteSchema, type PersonalMemorySnapshot } from "./model";
import { PersonalMemoryError, requirePersonalMemoryMembership } from "./access";

const bindingSchema = Schema.Struct({
  key: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(512),
    Schema.isTrimmed()
  ),
  namespace: Schema.NonEmptyString,
  value: Schema.NonEmptyString,
});

const makePersonalMemory = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const bind = Effect.fn("PersonalMemory.bind")(
    function* (scope: AccessScope, memory: MemoryOperationContext["memory"]) {
      yield* requirePersonalMemoryMembership(scope);
      const binding = yield* Schema.decodeUnknownEffect(bindingSchema)(
        memory.scope
      ).pipe(
        Effect.mapError(
          () => new PersonalMemoryError({ reason: "invalid_binding" })
        )
      );
      if (memory.slot !== "profile" || binding.value !== scope.workspaceId)
        return yield* new PersonalMemoryError({ reason: "invalid_binding" });
      // Only a trusted Eve callback supplies this opaque key. Never accept it from a route or tool input.
      yield* sql`INSERT INTO personal_memory_binding (key, workspace_id, namespace, slot)
        VALUES (${binding.key}, ${scope.workspaceId}, ${binding.namespace}, ${memory.slot})
        ON CONFLICT DO NOTHING`;
      const matches = yield* sql`SELECT key FROM personal_memory_binding
        WHERE key = ${binding.key} AND workspace_id = ${scope.workspaceId}
        AND namespace = ${binding.namespace} AND slot = ${memory.slot}`;
      if (matches.length !== 1)
        return yield* new PersonalMemoryError({ reason: "invalid_binding" });
      return undefined;
    },
    sql.withTransaction,
    Effect.catchTag(
      "SqlError",
      () => new PersonalMemoryError({ reason: "unavailable" })
    )
  );

  const inspect = Effect.fn("PersonalMemory.inspect")(
    function* (scope: AccessScope) {
      yield* requirePersonalMemoryMembership(scope);
      const profile = yield* Effect.tryPromise({
        try: () => readUserProfile(scope),
        catch: () => new PersonalMemoryError({ reason: "unavailable" }),
      });
      const bindings = yield* sql`SELECT key FROM personal_memory_binding
        WHERE workspace_id = ${scope.workspaceId} AND slot = 'profile'`;
      const rows =
        yield* sql`SELECT d.content, d.version, d.updated_at::text AS "updatedAt"
        FROM personal_memory_binding b INNER JOIN memory_document d ON d.key = b.key
        WHERE b.workspace_id = ${scope.workspaceId} AND b.slot = 'profile'
        ORDER BY b.namespace, b.key`;
      const documents = yield* Schema.decodeUnknownEffect(
        Schema.Array(storedNoteSchema)
      )(rows).pipe(
        Effect.mapError(
          () => new PersonalMemoryError({ reason: "unavailable" })
        )
      );
      yield* requirePersonalMemoryMembership(scope);
      return {
        scope: "stored-personal-memory",
        generatedAt: DateTime.formatIso(yield* DateTime.now),
        profile,
        notes: {
          status: bindings.length ? "located" : "unresolved",
          documents,
        },
        coverage: {
          included: ["structured-profile", "bound-profile-notes"],
          excluded: [
            "conversation-history",
            "artifacts",
            "connected-accounts",
            "schedules",
            "unbound-memory-documents",
          ],
        },
      } satisfies PersonalMemorySnapshot;
    },
    Effect.catchTag(
      "SqlError",
      () => new PersonalMemoryError({ reason: "unavailable" })
    )
  );

  return { bind, inspect };
});

export class PersonalMemory extends Context.Service<
  PersonalMemory,
  Effect.Success<typeof makePersonalMemory>
>()("companion/server/personal-memory/PersonalMemory") {
  static readonly layer = Layer.effect(PersonalMemory, makePersonalMemory);
}
