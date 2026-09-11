import { PgClient } from "@effect/sql-pg";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  emptyUserProfile,
  parseUserProfile,
  userProfilePatchSchema,
  userProfileSchema,
  type UserProfile,
  type UserProfilePatch,
} from "@shared/user-profile/schema";
import { Effect, Schema } from "effect";

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

function invalidUserProfileInput() {
  return new UserProfileError({ reason: "invalid_input" });
}

function invalidStoredUserProfile() {
  return new UserProfileError({ reason: "invalid_stored_profile" });
}

function parseStoredUserProfile(row: UserProfile) {
  return parseUserProfile(userProfileSchema.parse(row));
}

function profileColumnValues(patch: UserProfilePatch, normalized: UserProfile) {
  const entries: [string, unknown][] = [];

  for (const [key, column] of columns) {
    if (patch[key] === undefined) continue;
    entries.push([column, normalized[key]]);
  }

  return Object.fromEntries(entries);
}

const readUserProfileInTransaction = Effect.fn("readUserProfileInTransaction")(
  function* <E, R>(authorize: Effect.Effect<AccessScope, E, R>) {
    const sql = yield* PgClient.PgClient;
    const scope = yield* authorize;
    const selection = yield* profileSelection;

    const rows = yield* sql<UserProfile>`SELECT ${selection} FROM user_profiles
      WHERE workspace_id = ${scope.workspaceId}`;

    return yield* Effect.try({
      try: () => parseUserProfile(rows[0] ?? emptyUserProfile),
      catch: invalidStoredUserProfile,
    });
  }
);

// Every operation owns the transaction retaining authority locks through storage I/O.
export const readUserProfile = Effect.fn("readUserProfile")(function* <E, R>(
  authorize: Effect.Effect<AccessScope, E, R>
) {
  const sql = yield* PgClient.PgClient;

  return yield* sql.withTransaction(readUserProfileInTransaction(authorize));
});

export const replaceUserProfile = Effect.fn("replaceUserProfile")(function* <
  E,
  R,
>(authorize: Effect.Effect<AccessScope, E, R>, input: UserProfile) {
  const profile = yield* Effect.try({
    try: () => parseUserProfile(input),
    catch: invalidUserProfileInput,
  });

  return yield* patchUserProfile(authorize, profile);
});

const patchUserProfileInTransaction = Effect.fn(
  "patchUserProfileInTransaction"
)(function* <E, R>(
  authorize: Effect.Effect<AccessScope, E, R>,
  input: UserProfilePatch
) {
  const sql = yield* PgClient.PgClient;
  const scope = yield* authorize;

  const patch = yield* Effect.try({
    try: () => userProfilePatchSchema.parse(input),
    catch: invalidUserProfileInput,
  });

  const normalized = yield* Effect.try({
    try: () => parseUserProfile({ ...emptyUserProfile, ...patch }),
    catch: invalidUserProfileInput,
  });

  const values = profileColumnValues(patch, normalized);
  const selection = yield* profileSelection;

  const rows = yield* sql<UserProfile>`INSERT INTO user_profiles
      ${sql.insert({ workspace_id: scope.workspaceId, ...values })}
      ON CONFLICT (workspace_id) DO UPDATE SET ${sql.update(values)}, updated_at = clock_timestamp()
      RETURNING ${selection}`;

  return yield* Effect.try({
    try: () => parseStoredUserProfile(rows[0] ?? emptyUserProfile),
    catch: invalidStoredUserProfile,
  });
});

export const patchUserProfile = Effect.fn("patchUserProfile")(function* <E, R>(
  authorize: Effect.Effect<AccessScope, E, R>,
  input: UserProfilePatch
) {
  const sql = yield* PgClient.PgClient;

  return yield* sql.withTransaction(
    patchUserProfileInTransaction(authorize, input)
  );
});
