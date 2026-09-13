import type * as GoogleWorkspace from "../../server/google-workspace";
import { randomUUID } from "node:crypto";
import { auth as google } from "@googleapis/gmail";
import { symmetricEncrypt } from "better-auth/crypto";
import { Effect, Layer, Redacted, Result } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import {
  disconnectWorkspaceGoogle,
  getWorkspaceGoogleToken,
  shareGoogleConnection,
} from "../../server/workspaces/connections";
import { googleWorkspaceScopes } from "../../shared/google-workspace/connection";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const fixtureKey = "synthetic-google-connection-key-for-tests-only";
vi.mock("../../db/services/auth", async () => {
  const { Effect: Fx } = await import("effect");
  return {
    authentication: Fx.succeed({
      $context: Promise.resolve({
        secretConfig: "synthetic-google-connection-key-for-tests-only",
      }),
    }),
  };
});
vi.mock("../../server/google-workspace", async (original) => {
  const actual = await original<typeof GoogleWorkspace>();
  const { Effect: Fx, Redacted: Secret } = await import("effect");
  return {
    ...actual,
    getGoogleWorkspaceToken: () =>
      Fx.succeed(
        Secret.make({
          token: "synthetic-access-token",
          expiresAt: Date.now() + 3600_000,
        })
      ),
  };
});
const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
afterEach(() => vi.restoreAllMocks());

const googleFixture = Effect.fn("teamGoogle.fixture")(function* () {
  const fixture = yield* workspaceFixture();
  const subject = randomUUID();
  const refresh = yield* Effect.promise(() =>
    symmetricEncrypt({ key: fixtureKey, data: "synthetic-refresh-token" })
  );
  yield* fixture.sql`INSERT INTO account (id, issuer, "accountId", "providerId", "userId", "refreshToken", scope, "updatedAt")
    VALUES (${subject}, 'https://accounts.google.com', ${subject}, 'google', ${fixture.actor.userId.slice(12)}, ${refresh}, ${googleWorkspaceScopes.join(" ")}, now())`;
  vi.spyOn(google.OAuth2.prototype, "getTokenInfo").mockResolvedValue({
    sub: subject,
    email: "team@example.invalid",
    email_verified: true,
    aud: "synthetic-client",
    expiry_date: Date.now() + 3600_000,
    scopes: [...googleWorkspaceScopes],
  });
  return fixture;
});

test("an explicit verified Google share enables team tools without moving personal credentials", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, sql } = yield* googleFixture();
      expect(
        Result.isFailure(
          yield* shareGoogleConnection(guest).pipe(Effect.result)
        )
      ).toBe(true);
      yield* shareGoogleConnection(actor);
      expect((yield* readWorkspaceCapabilities(guest)).enabled).toContain(
        "google"
      );
      expect(Redacted.value(yield* getWorkspaceGoogleToken(guest)).token).toBe(
        "synthetic-access-token"
      );
      const stored = yield* sql<{
        credentials: string;
        label: string;
      }>`SELECT credentials, label FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`;
      expect(stored[0]?.label).toBe("team@example.invalid");
      expect(stored[0]?.credentials).not.toContain("synthetic-access-token");
      yield* sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`;
      expect(
        Result.isFailure(
          yield* getWorkspaceGoogleToken(guest).pipe(Effect.result)
        )
      ).toBe(true);
      yield* disconnectWorkspaceGoogle(actor);
      expect(
        Result.isFailure(
          yield* getWorkspaceGoogleToken(actor).pipe(Effect.result)
        )
      ).toBe(true);
      expect(
        yield* sql`SELECT id FROM account WHERE ('better-auth:' || "userId") = ${actor.userId}`
      ).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("an unverified provider identity cannot be published as a team connection", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, sql } = yield* googleFixture();
      vi.spyOn(google.OAuth2.prototype, "getTokenInfo").mockResolvedValue({
        sub: "another-subject",
        email: "unverified@example.invalid",
        email_verified: false,
        aud: "synthetic-client",
        expiry_date: Date.now() + 3600_000,
        scopes: [],
      });
      expect(
        Result.isFailure(
          yield* shareGoogleConnection(actor).pipe(Effect.result)
        )
      ).toBe(true);
      expect(
        yield* sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
      ).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("disconnect during token refresh cannot resurrect the shared credential", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, sql } = yield* googleFixture();
      yield* shareGoogleConnection(actor);
      const expired = yield* Effect.promise(() =>
        symmetricEncrypt({
          key: fixtureKey,
          data: JSON.stringify({
            workspaceId: actor.workspaceId,
            accessToken: "expired",
            refreshToken: "synthetic-refresh-token",
            expiresAt: 0,
          }),
        })
      );
      yield* sql`UPDATE workspace_connections SET credentials = ${expired} WHERE workspace_id = ${actor.workspaceId}`;
      vi.spyOn(
        google.OAuth2.prototype,
        "refreshAccessToken"
        // The Promise overload is selected by production refreshAccessToken().
        // oxlint-disable-next-line typescript/no-misused-promises
      ).mockImplementation(async () => {
        await Effect.runPromise(
          disconnectWorkspaceGoogle(actor).pipe(Effect.provide(services))
        );
        return {
          credentials: {
            access_token: "refreshed-after-disconnect",
            expiry_date: Date.now() + 3600_000,
          },
          res: null,
        };
      });
      expect(
        Result.isFailure(
          yield* getWorkspaceGoogleToken(actor).pipe(Effect.result)
        )
      ).toBe(true);
      expect(
        yield* sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
      ).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
