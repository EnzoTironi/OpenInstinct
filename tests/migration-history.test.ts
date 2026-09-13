import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { verifyMigrationPrefix } from "../server/database/migrations";

const source = [
  { hash: "first", folderMillis: 1000, sql: [], bps: true },
  { hash: "second", folderMillis: 2000, sql: [], bps: true },
];

describe("deployment migration history", () => {
  it("accepts an empty database and an exact released prefix", async () => {
    await expect(
      Effect.runPromise(verifyMigrationPrefix(source, [], "app"))
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(
        verifyMigrationPrefix(
          source,
          [{ hash: "first", created_at: 1000 }],
          "app"
        )
      )
    ).resolves.toBeUndefined();
  });
  it.each([
    [{ hash: "changed", created_at: 1000 }],
    [{ hash: "first", created_at: 999 }],
    [{ hash: "second", created_at: 2000 }],
    [
      { hash: "first", created_at: 1000 },
      { hash: "second", created_at: 2000 },
      { hash: "future", created_at: 3000 },
    ],
  ])("rejects rewritten, missing, or newer history", async (...rows) => {
    await expect(
      Effect.runPromise(verifyMigrationPrefix(source, rows, "app"))
    ).rejects.toThrow("migration history differs");
  });
});
