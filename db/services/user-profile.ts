import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  emptyUserProfile,
  parseUserProfile,
  userProfilePatchSchema,
  userProfileSchema,
  type UserProfile,
  type UserProfilePatch,
} from "@shared/user-profile/schema";

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

// Callers authorize and retain authority locks in the same Pg transaction.
export const readUserProfile = Effect.fn("readUserProfile")(function* (
  scope: AccessScope
) {
  const sql = yield* PgClient.PgClient;
  const selection = yield* profileSelection;
  const rows = yield* sql<UserProfile>`SELECT ${selection} FROM user_profiles
    WHERE workspace_id = ${scope.workspaceId}`;
  return yield* Effect.try(() => parseUserProfile(rows[0] ?? emptyUserProfile));
});

export const replaceUserProfile = Effect.fn("replaceUserProfile")(function* (
  scope: AccessScope,
  input: UserProfile
) {
  const profile = yield* Effect.try(() => parseUserProfile(input));
  return yield* patchUserProfile(scope, profile);
});

export const patchUserProfile = Effect.fn("patchUserProfile")(function* (
  scope: AccessScope,
  input: UserProfilePatch
) {
  const patch = yield* Effect.try(() => userProfilePatchSchema.parse(input));
  const normalized = yield* Effect.try(() =>
    parseUserProfile({ ...emptyUserProfile, ...patch })
  );
  const values = Object.fromEntries(
    columns
      .filter(([key]) => patch[key] !== undefined)
      .map(([key, column]) => [column, normalized[key]])
  );
  const sql = yield* PgClient.PgClient;
  const selection = yield* profileSelection;
  const rows = yield* sql<UserProfile>`INSERT INTO user_profiles
    ${sql.insert({ workspace_id: scope.workspaceId, ...values })}
    ON CONFLICT (workspace_id) DO UPDATE SET ${sql.update(values)}, updated_at = clock_timestamp()
    RETURNING ${selection}`;
  return yield* Effect.try(() =>
    parseUserProfile(userProfileSchema.parse(rows[0]))
  );
});
