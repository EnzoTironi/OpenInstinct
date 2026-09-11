import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { Effect, Schema } from "effect";

import { PersonalMemoryError, requirePersonalMemoryWebSession } from "./access";
import { PersonalMemory } from "./index";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

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
    "AuthUnavailable",
    () => new PersonalMemoryError({ reason: "unavailable" })
  )
);

export const exportPersonalMemory = Effect.fn("exportPersonalMemory")(
  function* (headers: Headers) {
    const snapshot = yield* inspectPersonalMemory(headers);

    return new Response(encodeJson(snapshot), {
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

    return yield* requirePersonalMemoryWebSession(
      accessScopeForUser(`better-auth:${session.user.id}`),
      session.session.id
    );
  }
);
