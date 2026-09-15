import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Redacted } from "effect";
import { expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import {
  applyAccountDeletionTombstones,
  requestAccountDeletion,
} from "../../server/accounts/deletion";
import { startWhatsAppPairing } from "../../server/workspaces/whatsapp";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { accountDeletionProvidersFixture } from "./account-deletion-providers-fixture";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";
import { erasureJournalFixture } from "./erasure-journal-fixture";

vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_MATRIX_URL: "http://127.0.0.1:14352",
      ZOEN_MATRIX_SERVER_NAME: "zoen.test",
      ZOEN_MATRIX_AS_TOKEN: Redacted.make(
        "synthetic-deletion-matrix-appservice-32bx"
      ),
      ZOEN_MATRIX_HS_TOKEN: Redacted.make(
        "synthetic-deletion-matrix-homeserver-32bxx"
      ),
      ZOEN_VAULTWARDEN_URL: "http://127.0.0.1:14352",
      ZOEN_VAULTWARDEN_CLIENT_SECRET: Redacted.make(
        "synthetic-deletion-vault-client-secret-32"
      ),
      ZOEN_WHATSAPP_BRIDGE_URL: "http://127.0.0.1:14352",
      ZOEN_WHATSAPP_PROVISIONING_SECRET: Redacted.make(
        "synthetic-deletion-whatsapp-provision-32b"
      ),
      ZOEN_WHATSAPP_AS_TOKEN: Redacted.make(
        "synthetic-deletion-whatsapp-appservice-32bxx"
      ),
    },
  };
});

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase),
  Layer.provideMerge(erasureJournalFixture)
);

const ledgerOf = Effect.fn("deletion.ledger")(function* (userId: string) {
  const sql = yield* PgClient.PgClient;
  return yield* sql<{
    status: string;
    surface: string;
  }>`SELECT l.surface, l.status FROM account_deletion_ledger l
    JOIN account_deletion_requests r ON r.id = l.request_id
    WHERE r.user_id = ${userId}`;
});

test("unreachable vault, WhatsApp and Matrix wipes stay pending_external", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { guest, guestPersonal, sql } = yield* workspaceFixture();
      yield* sql`INSERT INTO matrix_identities(user_id, matrix_id)
        VALUES (${guest.userId}, ${`@guest-${randomUUID()}:zoen.test`})`;
      yield* startWhatsAppPairing(guestPersonal);
      const deleted = yield* requestAccountDeletion(guest);
      expect(deleted.status).toBe("pending_external");
      expect(deleted.pending).toEqual(
        expect.arrayContaining(["vaultwarden", "whatsapp", "matrix", "mem0"])
      );
      const ledger = yield* ledgerOf(guest.userId);
      expect(
        ledger.filter((row) =>
          ["vaultwarden", "whatsapp", "matrix"].includes(row.surface)
        )
      ).toEqual(
        expect.arrayContaining([
          { status: "pending_external", surface: "vaultwarden" },
          { status: "pending_external", surface: "matrix" },
          { status: "pending_external", surface: "whatsapp" },
        ])
      );
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("tombstone retries vault after the provider recovers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { guest, guestPersonal, sql } = yield* workspaceFixture();
      yield* sql`INSERT INTO matrix_identities(user_id, matrix_id)
        VALUES (${guest.userId}, ${`@guest-${randomUUID()}:zoen.test`})`;
      yield* startWhatsAppPairing(guestPersonal);
      const deleted = yield* requestAccountDeletion(guest);
      expect(deleted.pending).toEqual(
        expect.arrayContaining(["vaultwarden", "whatsapp", "matrix"])
      );
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => accountDeletionProvidersFixture()),
        (server) => Effect.promise(() => server.close())
      );
      yield* applyAccountDeletionTombstones();
      const ledger = yield* ledgerOf(guest.userId);
      expect(ledger).toEqual(
        expect.arrayContaining([
          { status: "erased", surface: "vaultwarden" },
          { status: "pending_external", surface: "whatsapp" },
          { status: "pending_external", surface: "matrix" },
        ])
      );
      expect(fixture.vaultUsers).toContain(
        guest.userId.slice("better-auth:".length)
      );
      expect(fixture.logouts).toEqual([]);
      expect(fixture.deactivated).toEqual([]);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("fixture wipes mark vault, WhatsApp and Matrix erased and stay pending for Mem0", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => accountDeletionProvidersFixture()),
        (server) => Effect.promise(() => server.close())
      );
      const { guest, guestPersonal, sql } = yield* workspaceFixture();
      const matrixId = `@guest-${randomUUID()}:zoen.test`;
      yield* sql`INSERT INTO matrix_identities(user_id, matrix_id)
        VALUES (${guest.userId}, ${matrixId})`;
      const pairing = yield* startWhatsAppPairing(guestPersonal);
      expect(pairing.qr).toBe("synthetic-deletion-qr");
      const deleted = yield* requestAccountDeletion(guest);
      expect(deleted.status).toBe("pending_external");
      expect(deleted.pending).toEqual(expect.arrayContaining(["mem0"]));
      expect(deleted.pending).not.toContain("vaultwarden");
      expect(deleted.pending).not.toContain("whatsapp");
      expect(deleted.pending).not.toContain("matrix");
      const ledger = yield* ledgerOf(guest.userId);
      expect(ledger).toEqual(
        expect.arrayContaining([
          { status: "erased", surface: "vaultwarden" },
          { status: "erased", surface: "whatsapp" },
          { status: "erased", surface: "matrix" },
          { status: "pending_external", surface: "mem0" },
        ])
      );
      expect(fixture.vaultUsers).toContain(
        guest.userId.slice("better-auth:".length)
      );
      expect(fixture.deactivated).toContain(matrixId);
      expect(fixture.logouts.length).toBeGreaterThan(0);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("tombstone replay wipes restored rows again and retries fixture providers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => accountDeletionProvidersFixture()),
        (server) => Effect.promise(() => server.close())
      );
      const { actor, guest, guestPersonal, repository, sql } =
        yield* workspaceFixture();
      const companyCanary = `company-${randomUUID()}`;
      yield* repository.write(actor, {
        content: companyCanary,
        expectedRevision: null,
        operationId: randomUUID(),
        path: "knowledge/team.md",
      });
      yield* requestAccountDeletion(guest);
      yield* sql`INSERT INTO public.user (id, name, email) VALUES
        (${guest.userId.slice("better-auth:".length)}, 'Restored', ${`${randomUUID()}@example.invalid`})`;
      yield* sql`INSERT INTO workspaces (id) VALUES (${guestPersonal.workspaceId})`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${guestPersonal.workspaceId}, ${guest.userId}, 'owner')`;
      const restoredMatrix = `@restored-${randomUUID()}:zoen.test`;
      yield* sql`INSERT INTO vault_items (id, workspace_id, kind, label, account)
        VALUES (${`vault-${randomUUID()}`}, ${guestPersonal.workspaceId}, 'login', 'restored', 'restored@example.invalid')`;
      yield* sql`INSERT INTO encrypted_secrets (workspace_id, namespace, id, encrypted_value)
        VALUES (${guestPersonal.workspaceId}, 'vault', 'restored', 'ciphertext')`;
      yield* sql`INSERT INTO whatsapp_bridge_accounts (
          workspace_id, user_id, pairing_nonce_hash, remote_user_id, matrix_user_id, login_id, status, expires_at, connected_at
        ) VALUES (
          ${guestPersonal.workspaceId}, ${guest.userId}, 'restored', ${`wa-${randomUUID()}`},
          ${`@_zoen_wa_restored:zoen.test`}, ${randomUUID()}, 'connected', now() + interval '1 day', clock_timestamp()
        )`;
      yield* sql`INSERT INTO matrix_identities(user_id, matrix_id)
        VALUES (${guest.userId}, ${restoredMatrix})`;
      yield* applyAccountDeletionTombstones();
      expect(
        yield* sql`SELECT 1 FROM vault_items WHERE workspace_id = ${guestPersonal.workspaceId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM whatsapp_bridge_accounts WHERE workspace_id = ${guestPersonal.workspaceId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT 1 FROM matrix_identities WHERE user_id = ${guest.userId}`
      ).toHaveLength(0);
      expect((yield* repository.read(actor, "knowledge/team.md")).content).toBe(
        companyCanary
      );
      expect(fixture.deactivated).toContain(restoredMatrix);
      expect(fixture.logouts.length).toBeGreaterThan(0);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
