import { readUserProfile } from "@db/services/user-profile";
import { PgClient } from "@effect/sql-pg";
import type { AccessScope } from "@shared/identity/access-scope";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import type { MemoryOperationContext } from "eve/memory";

import { PersonalMemoryError, requirePersonalMemoryMembership } from "./access";
import { admitPersonalWipeTarget } from "./group-memory-policy";
import { storedNoteSchema, type PersonalMemorySnapshot } from "./model";

const bindingSchema = Schema.Struct({
  key: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(512),
    Schema.isTrimmed()
  ),
  namespace: Schema.NonEmptyString,
  value: Schema.NonEmptyString,
});

const decodeEffect_bindingSchema = Schema.decodeUnknownEffect(bindingSchema);

const makePersonalMemory = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;

  const bind = Effect.fn("PersonalMemory.bind")(
    function* (scope: AccessScope, memory: MemoryOperationContext["memory"]) {
      yield* requirePersonalMemoryMembership(scope);

      const binding = yield* decodeEffect_bindingSchema(memory.scope).pipe(
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

      const profile = yield* readUserProfile(
        requirePersonalMemoryMembership(scope)
      ).pipe(
        Effect.mapError(
          () => new PersonalMemoryError({ reason: "unavailable" })
        )
      );

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

  const wipe = Effect.fn("PersonalMemory.wipe")(
    function* (scope: AccessScope) {
      // G02: personal wipe is private-workspace only; never addresses group scope.
      const coverage = yield* admitPersonalWipeTarget({
        conversationScope: null,
        chatKind: "private",
      });

      yield* requirePersonalMemoryMembership(scope);
      // Bound profile documents only — unbound keys are intentionally out of coverage.
      yield* sql`DELETE FROM memory_document d
        USING personal_memory_binding b
        WHERE d.key = b.key
          AND b.workspace_id = ${scope.workspaceId}
          AND b.slot = 'profile'`;
      yield* sql`DELETE FROM personal_memory_binding
        WHERE workspace_id = ${scope.workspaceId} AND slot = 'profile'`;
      yield* sql`DELETE FROM user_profiles WHERE workspace_id = ${scope.workspaceId}`;
      yield* requirePersonalMemoryMembership(scope);

      return {
        wiped: coverage.wiped,
        neverWiped: coverage.neverWiped,
      };
    },
    sql.withTransaction,
    Effect.catchTag(
      "SqlError",
      () => new PersonalMemoryError({ reason: "unavailable" })
    )
  );

  return { bind, inspect, wipe };
});

export class PersonalMemory extends Context.Service<
  PersonalMemory,
  Effect.Success<typeof makePersonalMemory>
>()("companion/server/personal-memory/PersonalMemory") {
  static readonly layer = Layer.effect(PersonalMemory, makePersonalMemory);
}
