import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  emptyUserProfile,
  parseUserProfile,
  userProfilePatchSchema,
  userProfileSchema,
  type UserProfile,
  type UserProfilePatch,
} from "@shared/user-profile/schema";

export class UserProfileError extends Schema.TaggedError<UserProfileError>()(
  "UserProfileError",
  { reason: Schema.Literals(["invalid_input", "invalid_stored_profile"]) }
) {}

const columns = [
  ["addressLine1", "address_line_1"],
  ["addressLine2", "address_line_2"],
  ["city", "city"],
  ["countryCode", "country_code"],
  ["dateOfBirth", "date_of_birth"],
  ["email", "email"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["phone", "phone"],
  ["postalCode", "postal_code"],
  ["region", "region"],
] as const;

const profileSelection = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return sql`address_line_1 AS "addressLine1", address_line_2 AS "addressLine2",
    city, country_code AS "countryCode", date_of_birth::text AS "dateOfBirth",
    email, first_name AS "firstName", last_name AS "lastName", phone,
    postal_code AS "postalCode", region`;
});

// Every operation owns the transaction retaining authority locks through storage I/O.
export const readUserProfile = Effect.fn("readUserProfile")(function* <E, R>(
  authorize: Effect.Effect<AccessScope, E, R>
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const scope = yield* authorize;
      const selection = yield* profileSelection;
      const rows =
        yield* sql<UserProfile>`SELECT ${selection} FROM user_profiles
      WHERE workspace_id = ${scope.workspaceId}`;
      return yield* Effect.try({
        try: () => parseUserProfile(rows[0] ?? emptyUserProfile),
        catch: () => new UserProfileError({ reason: "invalid_stored_profile" }),
      });
    })
  );
});

export const replaceUserProfile = Effect.fn("replaceUserProfile")(function* <
  E,
  R,
>(authorize: Effect.Effect<AccessScope, E, R>, input: UserProfile) {
  const profile = yield* Effect.try({
    try: () => parseUserProfile(input),
    catch: () => new UserProfileError({ reason: "invalid_input" }),
  });
  return yield* patchUserProfile(authorize, profile);
});

export const patchUserProfile = Effect.fn("patchUserProfile")(function* <E, R>(
  authorize: Effect.Effect<AccessScope, E, R>,
  input: UserProfilePatch
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const scope = yield* authorize;
      const patch = yield* Effect.try({
        try: () => userProfilePatchSchema.parse(input),
        catch: () => new UserProfileError({ reason: "invalid_input" }),
      });
      const normalized = yield* Effect.try({
        try: () => parseUserProfile({ ...emptyUserProfile, ...patch }),
        catch: () => new UserProfileError({ reason: "invalid_input" }),
      });
      const values = Object.fromEntries(
        columns
          .filter(([key]) => patch[key] !== undefined)
          .map(([key, column]) => [column, normalized[key]])
      );
      const selection = yield* profileSelection;
      const rows = yield* sql<UserProfile>`INSERT INTO user_profiles
      ${sql.insert({ workspace_id: scope.workspaceId, ...values })}
      ON CONFLICT (workspace_id) DO UPDATE SET ${sql.update(values)}, updated_at = clock_timestamp()
      RETURNING ${selection}`;
      return yield* Effect.try({
        try: () => parseUserProfile(userProfileSchema.parse(rows[0])),
        catch: () => new UserProfileError({ reason: "invalid_stored_profile" }),
      });
    })
  );
});
