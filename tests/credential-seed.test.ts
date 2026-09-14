import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("deployment seeding preserves a refreshed credential across restarts and accepts explicit rotation", () => {
  const directory = mkdtempSync(join(tmpdir(), "zoen-auth-seed-"));
  const path = join(directory, "auth", "chatgpt.json");
  const initial = JSON.stringify({
    accessToken: "synthetic-initial",
    refreshToken: "synthetic-refresh",
  });
  const renewed = JSON.stringify({
    accessToken: "synthetic-renewed",
    refreshToken: "synthetic-rotated",
  });
  const replacement = JSON.stringify({
    accessToken: "synthetic-replacement",
    refreshToken: "synthetic-new-grant",
  });
  try {
    expect(
      execFileSync("sh", ["scripts/seed-credential.sh", path], {
        input: initial,
        encoding: "utf8",
      })
    ).toBe("");
    expect(readFileSync(path, "utf8")).toBe(initial);
    writeFileSync(path, renewed);
    expect(
      execFileSync("sh", ["scripts/seed-credential.sh", path], {
        input: initial,
        encoding: "utf8",
      })
    ).toBe("");
    expect(readFileSync(path, "utf8")).toBe(renewed);
    expect(
      execFileSync("sh", ["scripts/seed-credential.sh", path], {
        input: replacement,
        encoding: "utf8",
      })
    ).toBe("");
    expect(readFileSync(path, "utf8")).toBe(replacement);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
