import { randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import {
  AccountDeletionError,
  applyAccountDeletionTombstones,
  closeOrganizationForDeletion,
  requestAccountDeletion,
  transferOrganizationAdmin,
} from "../../server/accounts/deletion";
import {
  confirmWhatsAppPairing,
  startWhatsAppPairing,
} from "../../server/workspaces/whatsapp";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";
import { erasureJournalFixture } from "./erasure-journal-fixture";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase),
  Layer.provideMerge(erasureJournalFixture)
);
const denied = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isFailure(result)).toBe(true);
};

test("a company member's deletion keeps company git and never delivers to live providers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, guestPersonal, repository, sql } =
        yield* workspaceFixture();
      const personalCanary = `personal-${randomUUID()}`;
      const companyCanary = `company-${randomUUID()}`;
      yield* repository.write(guestPersonal, {
        content: personalCanary,
        expectedRevision: null,
        operationId: randomUUID(),
        path: "knowledge/private.md",
      });
      yield* repository.write(actor, {
        content: companyCanary,
        expectedRevision: null,
        operationId: randomUUID(),
        path: "knowledge/team.md",
      });
      yield* sql`INSERT INTO chats(session_id, workspace_id, title) VALUES
        (${randomUUID()}, ${guestPersonal.workspaceId}, ${personalCanary})`;
      yield* sql`INSERT INTO scheduled_agent_jobs(
          id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, next_run_at
        ) VALUES (
          ${randomUUID()}, ${guest.workspaceId}, ${guest.userId}, 'Synthetic schedule', 'eve', ${randomUUID()},
          '{"kind":"once","at":"2030-01-01T12:00:00Z"}', '2030-01-01T12:00:00Z'
        )`;
      yield* sql`INSERT INTO workspace_connections(workspace_id, label, credentials, connected_by)
        VALUES (${guest.workspaceId}, 'Shared Google', 'token', ${guest.userId})`;
      yield* sql`INSERT INTO telemetry_events(id, user_id, kind, metadata)
        VALUES (${randomUUID()}, ${guest.userId}, 'turn', '{}')`;
      yield* sql`INSERT INTO matrix_identities(user_id, matrix_id)
        VALUES (${guest.userId}, ${`@guest-${randomUUID()}:zoen.test`})`;
      const pairing = yield* startWhatsAppPairing(guestPersonal);
      yield* confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
        remoteUserId: `wa:${randomUUID()}`,
      });
      denied(
        yield* requestAccountDeletion({
          ...guest,
          authSessionId: undefined,
        }).pipe(Effect.result)
      );
      expect(
        (yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user" WHERE id = ${guest.userId.slice("better-auth:".length)}`)[0]
          ?.count
      ).toBe(1);
      const deleted = yield* requestAccountDeletion(guest);
      expect(deleted.status).toBe("pending_external");
      expect(deleted.pending).toEqual(
        expect.arrayContaining(["vaultwarden", "whatsapp", "matrix", "mem0"])
      );
      expect(deleted.backupExpiresAt).toMatch(/T/);
      expect(
        (yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user" WHERE id = ${guest.userId.slice("better-auth:".length)}`)[0]
          ?.count
      ).toBe(0);
      expect(
        yield* sql`SELECT 1 FROM public.session WHERE "userId" = ${guest.userId.slice("better-auth:".length)}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM workspaces WHERE id = ${guestPersonal.workspaceId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM chats WHERE title = ${personalCanary}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM workspace_repository WHERE workspace_id = ${guestPersonal.workspaceId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM scheduled_agent_jobs WHERE created_by_user_id = ${guest.userId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM telemetry_events WHERE user_id = ${guest.userId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM matrix_identities WHERE user_id = ${guest.userId}`
      ).toHaveLength(0);
      expect((yield* repository.read(actor, "knowledge/team.md")).content).toBe(
        companyCanary
      );
      expect(
        yield* sql`SELECT 1 FROM workspaces WHERE id = ${actor.workspaceId}`
      ).toHaveLength(1);
      expect(
        yield* sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
      ).toHaveLength(1);
      expect(
        yield* sql`SELECT 1 FROM account_deletion_tombstones WHERE user_id = ${guest.userId}`
      ).toHaveLength(1);
      denied(yield* requestAccountDeletion(guest).pipe(Effect.result));
      yield* sql`INSERT INTO public.user (id, name, email) VALUES
        (${guest.userId.slice("better-auth:".length)}, 'Restored', ${`${randomUUID()}@example.invalid`})`;
      yield* sql`INSERT INTO workspaces (id) VALUES (${guestPersonal.workspaceId})`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${guestPersonal.workspaceId}, ${guest.userId}, 'owner')`;
      yield* sql`INSERT INTO chats(session_id, workspace_id, title) VALUES
        (${randomUUID()}, ${guestPersonal.workspaceId}, ${personalCanary})`;
      yield* applyAccountDeletionTombstones();
      expect(
        yield* sql`SELECT 1 FROM chats WHERE title = ${personalCanary}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM public."user" WHERE id = ${guest.userId.slice("better-auth:".length)}`
      ).toHaveLength(0);
      expect((yield* repository.read(actor, "knowledge/team.md")).content).toBe(
        companyCanary
      );
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("the last company admin must transfer or close before deletion", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, sql } = yield* workspaceFixture();
      const orgs = yield* sql<{
        organization_id: string;
      }>`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`;
      const organizationId = orgs[0]?.organization_id ?? "";
      const blocked = yield* requestAccountDeletion(actor).pipe(Effect.result);
      expect(Result.isFailure(blocked) && blocked.failure).toBeInstanceOf(
        AccountDeletionError
      );
      expect(
        Result.isFailure(blocked) &&
          blocked.failure instanceof AccountDeletionError &&
          blocked.failure.reason
      ).toBe("blocked_sole_owner");
      expect(
        (yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user" WHERE id = ${actor.userId.slice("better-auth:".length)}`)[0]
          ?.count
      ).toBe(1);
      yield* transferOrganizationAdmin(actor, {
        organizationId,
        targetUserId: guest.userId,
      });
      const deleted = yield* requestAccountDeletion(actor);
      expect(deleted.status).toBe("pending_external");
      expect(
        yield* sql`SELECT 1 FROM public."user" WHERE id = ${actor.userId.slice("better-auth:".length)}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM workspaces WHERE id = ${actor.workspaceId}`
      ).toHaveLength(1);
      expect(
        yield* sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
      ).toHaveLength(1);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("closing the last company workspace unblocks the remaining owner", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, sql } = yield* workspaceFixture();
      const orgs = yield* sql<{
        organization_id: string;
      }>`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`;
      const organizationId = orgs[0]?.organization_id ?? "";
      yield* requestAccountDeletion(guest);
      denied(yield* requestAccountDeletion(actor).pipe(Effect.result));
      yield* closeOrganizationForDeletion(actor, { organizationId });
      expect(
        yield* sql`SELECT 1 FROM workspaces WHERE id = ${actor.workspaceId}`
      ).toHaveLength(0);
      const deleted = yield* requestAccountDeletion(actor);
      expect(deleted.status).toBe("pending_external");
      expect(
        yield* sql`SELECT 1 FROM public."user" WHERE id = ${actor.userId.slice("better-auth:".length)}`
      ).toHaveLength(0);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("review #119: concurrent deletion cannot leave a company without any administrator", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, sql } = yield* workspaceFixture();
      const org = yield* sql<{
        organization_id: string;
      }>`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`;
      const organizationId = org[0]?.organization_id;
      if (!organizationId) throw new Error("Company fixture missing");
      yield* sql`UPDATE organization_memberships SET role = 'admin' WHERE user_id = ${guest.userId}`;
      yield* sql`UPDATE workspace_memberships SET role = 'admin' WHERE user_id = ${guest.userId} AND workspace_id = ${actor.workspaceId}`;
      const results = yield* Effect.all(
        [
          requestAccountDeletion(actor).pipe(Effect.result),
          requestAccountDeletion(guest).pipe(Effect.result),
        ],
        { concurrency: 2 }
      );
      const admins =
        yield* sql`SELECT user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND role = 'admin'`;
      expect({
        completed: results.filter(Result.isSuccess).length,
        remainingAdmins: admins.length,
      }).toEqual({ completed: 1, remainingAdmins: 1 });
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
