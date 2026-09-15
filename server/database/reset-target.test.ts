import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  authorizeDisposableReset,
  confirmArgument,
  inspectResetTarget,
} from "./reset-target";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("inspectResetTarget", () => {
  it("does allow an explicit local disposable database", () => {
    expect(
      inspectResetTarget({
        confirm: "companion_runtime_test",
        connectionString:
          "postgresql://zoen_migrator:secret@127.0.0.1:5432/companion_runtime_test",
      })
    ).toEqual({
      databaseName: "companion_runtime_test",
      hostname: "127.0.0.1",
      kind: "allowed",
    });
  });

  it("does refuse a protected production-like target before connecting", async () => {
    const started = performance.now();
    const decision = inspectResetTarget({
      confirm: "open_instinct_prod",
      connectionString:
        "postgresql://postgres:prod-secret@companion-pg-prod.internal:5432/open_instinct_prod",
    });
    await expect(
      Effect.runPromise(
        authorizeDisposableReset(
          "postgresql://postgres:prod-secret@companion-pg-prod.internal:5432/open_instinct_prod",
          "open_instinct_prod"
        )
      )
    ).rejects.toThrow("Protected database");
    expect(decision).toEqual({
      kind: "refused",
      reason: "Protected database and host combinations cannot be reset.",
    });
    expect(JSON.stringify(decision)).not.toContain("prod-secret");
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("does refuse reset without an explicit matching confirm", () => {
    expect(
      inspectResetTarget({
        confirm: "",
        connectionString:
          "postgresql://postgres:postgres@127.0.0.1:5432/open_instinct",
      }).kind
    ).toBe("refused");
    expect(
      inspectResetTarget({
        confirm: "open_instinct_dev",
        connectionString:
          "postgresql://postgres:postgres@127.0.0.1:5432/open_instinct",
      }).kind
    ).toBe("refused");
  });

  it("does refuse unknown and remote disposable-looking names", () => {
    expect(
      inspectResetTarget({
        confirm: "postgres",
        connectionString:
          "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      }).kind
    ).toBe("refused");
    expect(
      inspectResetTarget({
        confirm: "companion_runtime_test",
        connectionString:
          "postgresql://postgres:postgres@db.example.com:5432/companion_runtime_test",
      }).kind
    ).toBe("refused");
    expect(
      inspectResetTarget({
        confirm: "open_instinct_staging",
        connectionString:
          "postgresql://postgres:postgres@127.0.0.1:5432/open_instinct_staging",
      }).kind
    ).toBe("refused");
  });

  it("does require --confirm on the reset command line", () => {
    expect(confirmArgument(["--confirm", "open_instinct"])).toBe(
      "open_instinct"
    );
    expect(confirmArgument([])).toBeUndefined();
    expect(confirmArgument(["--confirm"])).toBeUndefined();
  });

  it("does keep migrate-hosted from falling back to reset", () => {
    const migrateHosted = readFileSync(
      join(repositoryRoot, "scripts/migrate-hosted.ts"),
      "utf8"
    );
    const migrations = readFileSync(
      join(repositoryRoot, "server/database/migrations.ts"),
      "utf8"
    );
    expect(migrateHosted).not.toContain("resetDisposable");
    expect(migrateHosted).not.toContain("DROP SCHEMA");
    expect(migrations).not.toContain("resetDisposable");
    expect(migrations).not.toContain("DROP DATABASE");
  });
});
