import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";
import { z } from "zod";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const forbiddenImport =
  /@operon\/(?:alchemy|cell-auth|cli|gateway|generated-ui|mcp|osdk|recipes|runtime|skills|telemetry)/u;

const forbiddenStartup = [
  "applySchema",
  "workspace-state",
  "--workspace",
  "Generated UI",
  "cell-auth",
  "stdio",
];

function walkTypeScript(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return [...walkTypeScript(path)];
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

it("does depend only on effect", () => {
  const manifest = z
    .object({
      dependencies: z.record(z.string(), z.string()),
    })
    .parse(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")));
  expect(Object.keys(manifest.dependencies)).toEqual(["effect"]);
});

it("does keep the extract free of cell, MCP, snapshot and migrator imports", () => {
  for (const file of walkTypeScript(join(packageRoot, "src"))) {
    if (file.endsWith(".test.ts")) continue;
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(forbiddenImport);
    for (const token of forbiddenStartup) {
      expect(source, `${file} mentions ${token}`).not.toContain(token);
    }
  }
});
