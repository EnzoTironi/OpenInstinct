/* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- PgClient stub is intentionally incomplete; fail-closed auth returns before any SQL method runs. */
import { PgClient } from "@effect/sql-pg";
import type { AccessScope } from "@shared/identity/access-scope";
import { Effect, Layer, ManagedRuntime } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalMemory } from "../personal-memory";
import { PersonalMemoryError } from "../personal-memory/access";
import type * as PersonalMemoryAccess from "../personal-memory/access";

const readAuthSessionMock = vi.hoisted(() =>
  vi.fn<(headers: Headers) => Effect.Effect<null>>((_headers) =>
    Effect.succeed(null)
  )
);

vi.mock("@db/services/auth/session", () => ({
  readAuthSession: (headers: Headers) => readAuthSessionMock(headers),
}));

vi.mock("../personal-memory/export", () => ({
  inspectPersonalMemory: Effect.fn("inspectPersonalMemory")(function* (
    headers: Headers
  ) {
    yield* readAuthSessionMock(headers);

    return yield* new PersonalMemoryError({ reason: "unauthenticated" });
  }),
}));

vi.mock("../personal-memory/access", async (importOriginal) => {
  const actual = await importOriginal<typeof PersonalMemoryAccess>();

  return {
    ...actual,
    requirePersonalMemoryWebSession: Effect.fn(
      "requirePersonalMemoryWebSession"
    )(function* (_scope: AccessScope, _sessionId: string) {
      return yield* new actual.PersonalMemoryError({
        reason: "unauthenticated",
      });
    }),
  };
});

import {
  AccountPrivacyError,
  accountPrivacyErrorResponse,
  deleteAccountOnlineData,
  exportAccountPrivacy,
} from "./privacy";

const wipeMock = vi.hoisted(() =>
  vi.fn<(scope: AccessScope) => void>(() => undefined)
);

const sqlMock = vi.hoisted(() =>
  vi.fn<() => Effect.Effect<never>>(() =>
    Effect.die("SQL must not run without auth")
  )
);

function mockPgClientService(
  sql: typeof sqlMock & {
    withTransaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>;
  }
): typeof PgClient.PgClient.Service {
  return sql as never;
}

function privacyRuntime() {
  const sql = Object.assign(sqlMock, {
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
  });

  return ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(PersonalMemory, {
        bind: () => Effect.die("bind must not run without auth"),
        inspect: () => Effect.die("inspect must not run without auth"),
        wipe: (scope: AccessScope) => {
          wipeMock(scope);

          return Effect.die("wipe must not run without auth");
        },
      }),
      Layer.succeed(PgClient.PgClient, mockPgClientService(sql))
    )
  );
}

describe("account privacy gates", () => {
  beforeEach(() => {
    readAuthSessionMock.mockReset();
    readAuthSessionMock.mockImplementation(() => Effect.succeed(null));
    wipeMock.mockReset();
    sqlMock.mockClear();
  });

  it("export fails closed without auth and never wipes personal memory", async () => {
    const runtime = privacyRuntime();
    await expect(
      runtime.runPromise(exportAccountPrivacy(new Headers()))
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    expect(wipeMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("delete fails closed without auth and never wipes personal memory", async () => {
    const runtime = privacyRuntime();
    await expect(
      runtime.runPromise(deleteAccountOnlineData(new Headers()))
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    expect(wipeMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("maps unauthenticated privacy errors to HTTP 401 fail-closed responses", () => {
    const response = accountPrivacyErrorResponse(
      new AccountPrivacyError({ reason: "unauthenticated" })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps unavailable privacy errors to HTTP 503", () => {
    const response = accountPrivacyErrorResponse(
      new AccountPrivacyError({ reason: "unavailable" })
    );

    expect(response.status).toBe(503);
  });
});
