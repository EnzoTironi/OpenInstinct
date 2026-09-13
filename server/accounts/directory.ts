import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export const UsernameSchema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]{2,29}$/)
);
export const DirectoryProfileSchema = Schema.Struct({
  username: UsernameSchema,
  discoverable: Schema.Boolean,
});
const reserved = new Set([
  "admin",
  "administrator",
  "support",
  "security",
  "zoen",
  "system",
  "everyone",
  "executor",
  "api",
  "root",
]);
class DirectoryError extends Schema.TaggedError<DirectoryError>()(
  "DirectoryError",
  {
    reason: Schema.Literals(["unavailable", "reserved", "invalid"]),
  }
) {}

export const readDirectoryProfile = Effect.fn("readDirectoryProfile")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    yield* requireWorkspaceAccess(actor);
    const sql = yield* PgClient.PgClient;
    const rows =
      yield* sql`SELECT username, discoverable FROM user_directory WHERE ('better-auth:' || user_id) = ${actor.userId}`;
    return rows[0]
      ? yield* Schema.decodeUnknownEffect(DirectoryProfileSchema)(rows[0])
      : null;
  }
);

export const saveDirectoryProfile = Effect.fn("saveDirectoryProfile")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof DirectoryProfileSchema.Type
  ) {
    const profile = yield* Schema.decodeUnknownEffect(DirectoryProfileSchema)(
      raw
    );
    if (reserved.has(profile.username))
      return yield* new DirectoryError({ reason: "reserved" });
    const sql = yield* PgClient.PgClient;
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireWorkspaceAccess(actor);
          if (!actor.authSessionId)
            return yield* new DirectoryError({ reason: "invalid" });
          const rows =
            yield* sql`INSERT INTO user_directory (user_id, username, discoverable)
      SELECT id, ${profile.username}, ${profile.discoverable} FROM public.user WHERE ('better-auth:' || id) = ${actor.userId}
      ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, discoverable = EXCLUDED.discoverable RETURNING username, discoverable`;
          return yield* Schema.decodeUnknownEffect(DirectoryProfileSchema)(
            rows[0]
          );
        })
      )
      .pipe(
        Effect.catchTag(
          "SqlError",
          () => new DirectoryError({ reason: "unavailable" })
        )
      );
  }
);

export const searchDirectory = Effect.fn("searchDirectory")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  query: string
) {
  yield* requireWorkspaceAccess(actor);
  const prefix = query.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(prefix)) return [];
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT username FROM user_directory WHERE discoverable = true AND starts_with(username, ${prefix}) ORDER BY username LIMIT 12`;
  return yield* Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({ username: UsernameSchema }))
  )(rows);
});
