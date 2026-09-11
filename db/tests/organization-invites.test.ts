/* oxlint-disable eslint/no-await-in-loop -- Migrations and their statements must be applied in order. */
import { readFile } from "node:fs/promises";

import * as Database from "@db";
import { PGlite } from "@electric-sql/pglite";
import { OrgSsoDenied } from "@shared/identity/org-sso";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("C02 organization invites + audit + erasure", () => {
  it("invites via Google SSO path, audits receipts, fail-closes erasure", async () => {
    const client = new PGlite();
    databases.push(client);

    for (const migration of [
      "0000_fluffy_the_spike.sql",
      "0029_org-workspace-rbac.sql",
      "0030_org-sso-audit-erasure.sql",
    ]) {
      await applyMigration(client, migration);
    }

    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by this service while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);

    const organizations = await import("@db/services/organizations");
    const invites = await import("@db/services/organization-invites");
    const audit = await import("@db/services/organization-audit");
    expect(audit.organizationAuditActions).toContain("invite_created");
    const erasure = await import("@db/services/organization-erasure");

    await organizations.createOrganization({
      organizationId: "org-acme",
      name: "Acme",
      adminUserId: "alice",
    });

    await Effect.runPromise(
      invites.createOrganizationInvite({
        inviteId: "inv-bob",
        organizationId: "org-acme",
        actorUserId: "alice",
        email: "bob@acme.example",
        role: "member",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        receiptId: "rcpt-invite",
        allowedDomains: ["acme.example"],
      })
    );

    const deniedAccept = await Effect.runPromise(
      invites
        .acceptOrganizationInvite({
          inviteId: "inv-bob",
          identity: {
            userId: "bob",
            email: "bob@acme.example",
            emailVerified: true,
            hasGoogleAccount: false,
          },
          receiptId: "rcpt-accept-denied",
        })
        .pipe(Effect.flip)
    );

    expect(deniedAccept).toEqual(
      new OrgSsoDenied({
        reason: "google_account_missing",
        message:
          "Link a Google account (Workspace SSO) before accepting an organization invite.",
      })
    );

    await Effect.runPromise(
      invites.acceptOrganizationInvite({
        inviteId: "inv-bob",
        identity: {
          userId: "bob",
          email: "bob@acme.example",
          emailVerified: true,
          hasGoogleAccount: true,
        },
        receiptId: "rcpt-accept",
      })
    );

    await Effect.runPromise(
      invites.createOrganizationInvite({
        inviteId: "inv-carol",
        organizationId: "org-acme",
        actorUserId: "alice",
        email: "carol@acme.example",
        role: "member",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        receiptId: "rcpt-invite-carol",
        allowedDomains: ["acme.example"],
      })
    );
    await Effect.runPromise(
      invites.revokeOrganizationInvite({
        inviteId: "inv-carol",
        organizationId: "org-acme",
        actorUserId: "alice",
        receiptId: "rcpt-revoke-carol",
      })
    );

    await Effect.runPromise(
      invites.setOrganizationMemberRoleAudited({
        organizationId: "org-acme",
        actorUserId: "alice",
        targetUserId: "bob",
        role: "member",
        receiptId: "rcpt-role",
      })
    );

    await Effect.runPromise(
      invites.removeOrganizationMember({
        organizationId: "org-acme",
        actorUserId: "alice",
        targetUserId: "bob",
        receiptId: "rcpt-remove",
      })
    );

    const decision = await Effect.runPromise(
      erasure.requestOrganizationErasure({
        organizationId: "org-acme",
        actorUserId: "alice",
        requestReceiptId: "rcpt-erase-req",
        decisionReceiptId: "rcpt-erase-den",
      })
    );

    expect(decision.status).toBe("denied");
    expect(decision.reason).toBe("cascade_unimplemented");

    const receipts = await audit.listOrganizationAuditReceipts("org-acme");
    const actions = receipts.map((row) => row.action).toSorted();
    expect(actions).toEqual(
      [
        "invite_accepted",
        "invite_created",
        "invite_created",
        "invite_revoked",
        "member_removed",
        "member_role_changed",
        "org_erasure_denied",
        "org_erasure_requested",
      ].toSorted()
    );
  }, 20_000);
});

async function applyMigration(database: PGlite, filename: string) {
  const migration = await readFile(
    new URL(`../migrations/${filename}`, import.meta.url),
    "utf8"
  );

  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}
