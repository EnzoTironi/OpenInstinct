import { Effect } from "effect";
import { PgClient } from "@effect/sql-pg";
import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { PersonalMemory } from "./index";
import { PersonalMemoryError, requirePersonalMemoryMembership } from "./access";

export const inspectPersonalMemory = Effect.fn("inspectPersonalMemory")(
  function* (headers: Headers) {
    const scope = yield* requirePersonalMemorySession(headers);
    const memory = yield* PersonalMemory;
    const snapshot = yield* memory.inspect(scope);
    // Better Auth may cache a session. The access operation also checks its live SQL row.
    yield* requirePersonalMemorySession(headers);
    return snapshot;
  },
  Effect.catchTag(
    ["AuthUnavailable", "SqlError"],
    () => new PersonalMemoryError({ reason: "unavailable" })
  )
);

export const exportPersonalMemory = Effect.fn("exportPersonalMemory")(
  function* (headers: Headers) {
    const snapshot = yield* inspectPersonalMemory(headers);
    return new Response(JSON.stringify(snapshot, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition":
          'attachment; filename="companion-personal-memory.json"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
);

const requirePersonalMemorySession = Effect.fn("requirePersonalMemorySession")(
  function* (headers: Headers) {
    const session = yield* readAuthSession(headers);
    if (!session)
      return yield* new PersonalMemoryError({ reason: "unauthenticated" });
    const scope = yield* requirePersonalMemoryMembership(
      accessScopeForUser(`better-auth:${session.user.id}`)
    );
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql`SELECT id FROM public.session
    WHERE id = ${session.session.id} AND "userId" = ${session.user.id}
    AND "expiresAt" > clock_timestamp()`;
    if (rows.length !== 1)
      return yield* new PersonalMemoryError({ reason: "unauthenticated" });
    return scope;
  }
);
