import { randomUUID } from "node:crypto";
import type { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  readDirectoryProfile,
  saveDirectoryProfile,
  searchDirectory,
} from "../../server/accounts/directory";
import {
  answerWorkspaceInvitation,
  inviteWorkspaceMember,
  readWorkspaceInvitations,
  readWorkspaceTeam,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
} from "../../server/workspaces/team";
import { workspaceFixture } from "./workspace-fixture";
import { runtimeDatabase } from "./database";

const run = (
  body: (
    fixture: Effect.Success<ReturnType<typeof workspaceFixture>>
  ) => Effect.Effect<void, unknown, PgClient.PgClient>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* body(yield* workspaceFixture());
    }).pipe(
      Effect.scoped,
      Effect.provide(
        WorkspaceRepository.layer.pipe(Layer.provideMerge(runtimeDatabase))
      )
    )
  );

test("usernames are unique, reserved names are rejected and search respects opt-in", () =>
  run(({ actor, guest }) =>
    Effect.gen(function* () {
      const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      yield* saveDirectoryProfile(actor, { username, discoverable: false });
      expect((yield* readDirectoryProfile(actor))?.username).toBe(username);
      expect(yield* searchDirectory(guest, username)).toEqual([]);
      const collision = yield* saveDirectoryProfile(guest, {
        username,
        discoverable: true,
      }).pipe(Effect.result);
      expect(Result.isFailure(collision)).toBe(true);
      yield* saveDirectoryProfile(actor, { username, discoverable: true });
      expect(yield* searchDirectory(guest, username)).toEqual([{ username }]);
      expect(yield* searchDirectory(guest, "%")).toEqual([]);
      const reserved = yield* saveDirectoryProfile(guest, {
        username: "admin",
        discoverable: true,
      }).pipe(Effect.result);
      expect(Result.isFailure(reserved) && reserved.failure).toMatchObject({
        reason: "reserved",
      });
    })
  ));

test("a named invitation grants no access until its recipient accepts; removal revokes files immediately", () =>
  run(({ sql, actor, guest, guestPersonal, repository }) =>
    Effect.gen(function* () {
      const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      yield* saveDirectoryProfile(guestPersonal, {
        username,
        discoverable: false,
      });
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`;
      yield* repository.write(actor, {
        operationId: randomUUID(),
        path: "knowledge/team.md",
        content: "Shared only after joining",
        expectedRevision: null,
      });
      const invitation = yield* inviteWorkspaceMember(actor, username);
      expect((yield* readWorkspaceInvitations(guestPersonal))[0]?.id).toBe(
        invitation.id
      );
      expect((yield* readWorkspaceTeam(actor)).invites).toHaveLength(1);
      const unauthorized = yield* repository.read(guest).pipe(Effect.result);
      expect(
        Result.isFailure(unauthorized) && unauthorized.failure
      ).toBeInstanceOf(WorkspaceAccessDenied);
      if (!invitation.id) throw new Error("Invitation ID missing");
      const theft = yield* answerWorkspaceInvitation(
        actor,
        invitation.id,
        true
      ).pipe(Effect.result);
      expect(Result.isFailure(theft) && theft.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      yield* answerWorkspaceInvitation(guestPersonal, invitation.id, true);
      expect((yield* repository.read(guest)).files).toEqual([
        "knowledge/team.md",
      ]);
      const escalation = yield* inviteWorkspaceMember(guest, username).pipe(
        Effect.result
      );
      expect(Result.isFailure(escalation) && escalation.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      const selfRemoval = yield* removeWorkspaceMember(
        actor,
        actor.userId
      ).pipe(Effect.result);
      expect(Result.isFailure(selfRemoval)).toBe(true);
      yield* removeWorkspaceMember(actor, guest.userId);
      const removed = yield* repository.export(guest).pipe(Effect.result);
      expect(Result.isFailure(removed) && removed.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      expect(yield* readWorkspaceInvitations(guestPersonal)).toEqual([]);
    })
  ));

test("revoked or expired invitations cannot be accepted", () =>
  run(({ sql, actor, guest, guestPersonal }) =>
    Effect.gen(function* () {
      const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      yield* saveDirectoryProfile(guestPersonal, {
        username,
        discoverable: false,
      });
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`;
      const first = yield* inviteWorkspaceMember(actor, username);
      if (!first.id) throw new Error("Invitation ID missing");
      yield* revokeWorkspaceInvitation(actor, first.id);
      expect(
        Result.isFailure(
          yield* answerWorkspaceInvitation(guestPersonal, first.id, true).pipe(
            Effect.result
          )
        )
      ).toBe(true);
      const second = yield* inviteWorkspaceMember(actor, username);
      if (!second.id) throw new Error("Invitation ID missing");
      yield* sql`UPDATE workspace_invites SET expires_at = now() - interval '1 minute' WHERE id = ${second.id}`;
      expect(
        Result.isFailure(
          yield* answerWorkspaceInvitation(guestPersonal, second.id, true).pipe(
            Effect.result
          )
        )
      ).toBe(true);
    })
  ));
