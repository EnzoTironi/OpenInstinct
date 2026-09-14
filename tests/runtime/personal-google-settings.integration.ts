import { randomUUID } from "node:crypto";
import type * as Environment from "@shared/environment";
import { Effect, Layer, Result } from "effect";
import { expect, test, vi } from "vitest";
import {
  activatePersonalGoogle,
  readPersonalGoogleSettings,
} from "../../server/google-workspace/settings";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { googleWorkspaceScopes } from "../../shared/google-workspace/connection";
import { capabilitiesPath } from "../../shared/workspaces/capabilities";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      GOOGLE_CLIENT_ID: "synthetic-google-client",
      GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    },
  };
});

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);

test("Google connection activation enables personal tools without sharing credentials or altering team plugins", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { personal, actor, sql } = yield* workspaceFixture();
      expect(yield* readPersonalGoogleSettings(personal)).toEqual({
        state: "disconnected",
      });
      expect(yield* activatePersonalGoogle(personal)).toEqual({
        authorize: true,
      });
      const enabled = yield* readWorkspaceCapabilities(personal);
      expect(enabled.enabled).toEqual(["files", "memory", "google"]);
      expect((yield* readWorkspaceCapabilities(actor)).enabled).toEqual([
        "files",
        "memory",
      ]);
      expect(yield* activatePersonalGoogle(personal)).toEqual({
        authorize: true,
      });
      expect((yield* readWorkspaceCapabilities(personal)).revision).toBe(
        enabled.revision
      );
      expect(
        yield* sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id IN (${personal.workspaceId}, ${actor.workspaceId})`
      ).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("reading a paused Google connection cannot reactivate it; explicit activation resumes the existing grant", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { personal, sql, repository } = yield* workspaceFixture();
      const id = randomUUID();
      yield* sql`INSERT INTO account (id, issuer, "accountId", "providerId", "userId", "refreshToken", scope, "updatedAt")
        VALUES (${id}, 'https://accounts.google.com', ${id}, 'google', ${personal.userId.slice(12)}, 'synthetic-token-preserved', ${googleWorkspaceScopes.join(" ")}, now())`;
      expect(yield* readPersonalGoogleSettings(personal)).toEqual({
        state: "paused",
      });
      expect(
        (yield* readWorkspaceCapabilities(personal)).enabled
      ).not.toContain("google");
      expect(yield* activatePersonalGoogle(personal)).toEqual({
        authorize: false,
      });
      expect(yield* readPersonalGoogleSettings(personal)).toEqual({
        state: "connected",
      });
      const enabled = yield* readWorkspaceCapabilities(personal);
      yield* repository.write(personal, {
        path: capabilitiesPath,
        operationId: randomUUID(),
        expectedRevision: enabled.revision,
        content: JSON.stringify({ version: 1, enabled: ["files", "ontology"] }),
      });
      expect(yield* readPersonalGoogleSettings(personal)).toEqual({
        state: "paused",
      });
      expect((yield* readWorkspaceCapabilities(personal)).enabled).toEqual([
        "files",
        "ontology",
      ]);
      yield* activatePersonalGoogle(personal);
      expect((yield* readWorkspaceCapabilities(personal)).enabled).toEqual([
        "files",
        "ontology",
        "google",
      ]);
      expect(
        yield* sql`SELECT "refreshToken" FROM account WHERE id = ${id}`
      ).toEqual([{ refreshToken: "synthetic-token-preserved" }]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("personal Google activation rejects team targets, substituted sessions and revoked sessions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { personal, guestPersonal, actor, sql } = yield* workspaceFixture();
      for (const invalid of [
        actor,
        { ...personal, authSessionId: guestPersonal.authSessionId },
      ]) {
        expect(
          Result.isFailure(
            yield* activatePersonalGoogle(invalid).pipe(Effect.result)
          )
        ).toBe(true);
      }
      yield* sql`DELETE FROM public.session WHERE id = ${personal.authSessionId}`;
      expect(
        Result.isFailure(
          yield* activatePersonalGoogle(personal).pipe(Effect.result)
        )
      ).toBe(true);
      expect((yield* readWorkspaceCapabilities(guestPersonal)).enabled).toEqual(
        ["files", "memory"]
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
