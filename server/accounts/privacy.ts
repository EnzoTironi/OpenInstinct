import { readAuthSession } from "@db/services/auth/session";
import { PgClient } from "@effect/sql-pg";
import { accessScopeForUser } from "@shared/identity/access-scope";
import {
  accountOnlineWipeLimits,
  accountOnlineWipeNotWiped,
  accountPrivacyExportExcluded,
  accountPrivacyExportLimits,
} from "@shared/identity/account-privacy-limits";
import { Effect, Schema } from "effect";

import { PersonalMemory } from "../personal-memory";
import { requirePersonalMemoryWebSession } from "../personal-memory/access";
import type { PersonalMemoryError } from "../personal-memory/access";
import { inspectPersonalMemory } from "../personal-memory/export";

/**
 * Account privacy export/delete gates.
 *
 * Fail closed without a live Better Auth session + canonical membership.
 * Export and delete cover stored personal memory only — not a full-account
 * backup, restore contract, or complete erasure (see README).
 */
export class AccountPrivacyError extends Schema.TaggedError<AccountPrivacyError>()(
  "AccountPrivacyError",
  {
    reason: Schema.Literals(["unauthenticated", "unavailable"]),
  }
) {}

const requirePrivacySession = Effect.fn("requirePrivacySession")(function* (
  headers: Headers
) {
  const session = yield* readAuthSession(headers);

  if (!session)
    return yield* new AccountPrivacyError({ reason: "unauthenticated" });
  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  yield* requirePersonalMemoryWebSession(scope, session.session.id).pipe(
    Effect.mapError((error: PersonalMemoryError) =>
      error.reason === "unavailable"
        ? new AccountPrivacyError({ reason: "unavailable" })
        : new AccountPrivacyError({ reason: "unauthenticated" })
    )
  );

  return { session, scope };
});

export const exportAccountPrivacy = Effect.fn("exportAccountPrivacy")(
  function* (headers: Headers) {
    const snapshot = yield* inspectPersonalMemory(headers).pipe(
      Effect.mapError((error: PersonalMemoryError) =>
        error.reason === "unavailable"
          ? new AccountPrivacyError({ reason: "unavailable" })
          : new AccountPrivacyError({ reason: "unauthenticated" })
      )
    );

    return {
      scope: "account-privacy-export" as const,
      generatedAt: snapshot.generatedAt,
      personalMemory: snapshot,
      coverage: {
        included: snapshot.coverage.included,
        excluded: accountPrivacyExportExcluded,
        limits: accountPrivacyExportLimits,
      },
    };
  }
);

export const deleteAccountOnlineData = Effect.fn("deleteAccountOnlineData")(
  function* (headers: Headers) {
    const { session, scope } = yield* requirePrivacySession(headers);
    const memory = yield* PersonalMemory;

    const wiped = yield* memory
      .wipe(scope)
      .pipe(
        Effect.mapError((error: PersonalMemoryError) =>
          error.reason === "unavailable"
            ? new AccountPrivacyError({ reason: "unavailable" })
            : new AccountPrivacyError({ reason: "unauthenticated" })
        )
      );

    const sql = yield* PgClient.PgClient;
    yield* sql`DELETE FROM public.session WHERE "userId" = ${session.user.id}`;

    // Re-check membership after wipe; session rows are already gone.
    const membership = yield* sql`SELECT workspace_id FROM workspace_memberships
      WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId}`;

    if (membership.length !== 1)
      return yield* new AccountPrivacyError({ reason: "unauthenticated" });

    return {
      status: "partial_online_wipe" as const,
      wiped: wiped.wiped,
      notWiped: accountOnlineWipeNotWiped,
      limits: accountOnlineWipeLimits,
    };
  },
  Effect.catchTag(
    "SqlError",
    () => new AccountPrivacyError({ reason: "unavailable" })
  )
);

export const exportAccountPrivacyResponse = Effect.fn(
  "exportAccountPrivacyResponse"
)(function* (headers: Headers) {
  const body = yield* exportAccountPrivacy(headers);

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition":
        'attachment; filename="companion-account-privacy.json"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

export const deleteAccountOnlineDataResponse = Effect.fn(
  "deleteAccountOnlineDataResponse"
)(function* (headers: Headers) {
  const body = yield* deleteAccountOnlineData(headers);

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

export function accountPrivacyErrorResponse(error: AccountPrivacyError) {
  return new Response(
    error.reason === "unauthenticated"
      ? "Sign in to manage account privacy."
      : "Account privacy is unavailable. Try again.",
    {
      status: error.reason === "unauthenticated" ? 401 : 503,
      headers: { "cache-control": "private, no-store" },
    }
  );
}
