/* oxlint-disable eslint/no-await-in-loop -- Migrations and their statements must be applied in order. */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("C01 organizations service", () => {
  it("creates orgs, company workspaces, and blocks member elevation", async () => {
    const client = new PGlite();
    databases.push(client);
    for (const migration of [
      "0000_fluffy_the_spike.sql",
      "0029_org-workspace-rbac.sql",
    ]) {
      await applyMigration(client, migration);
    }

    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by this service while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);

    const organizations = await import("@db/services/organizations");

    await organizations.createOrganization({
      organizationId: "org-acme",
      name: "Acme",
      adminUserId: "alice",
    });
    expect(await organizations.countOrganizationAdmins("org-acme")).toBe(1);

    await Effect.runPromise(
      organizations.createCompanyWorkspace({
        organizationId: "org-acme",
        workspaceId: "workspace:acme",
        actorUserId: "alice",
      })
    );

    await Effect.runPromise(
      organizations.setOrganizationMemberRole({
        organizationId: "org-acme",
        actorUserId: "alice",
        targetUserId: "bob",
        role: "member",
      })
    );

    const denied = await Effect.runPromise(
      organizations
        .setOrganizationMemberRole({
          organizationId: "org-acme",
          actorUserId: "bob",
          targetUserId: "carol",
          role: "admin",
        })
        .pipe(Effect.flip)
    );
    expect(denied._tag).toBe("RbacDenied");
    expect(denied).toMatchObject({ reason: "not_admin" });

    await Effect.runPromise(
      organizations.setWorkspaceMemberRole({
        workspaceId: "workspace:acme",
        actorUserId: "alice",
        targetUserId: "bob",
        role: "member",
      })
    );

    const workspaceDenied = await Effect.runPromise(
      organizations
        .setWorkspaceMemberRole({
          workspaceId: "workspace:acme",
          actorUserId: "bob",
          targetUserId: "carol",
          role: "admin",
        })
        .pipe(Effect.flip)
    );
    expect(workspaceDenied._tag).toBe("RbacDenied");
  }, 15_000);
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
