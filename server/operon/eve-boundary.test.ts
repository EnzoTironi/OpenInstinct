import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const eveTool = readFileSync(join(here, "legacy-tools.ts"), "utf8");
const operonDir = here;

it("does keep Eve free of @operon/runtime and a second Better Auth", () => {
  expect(eveTool).toContain("email-register");
  expect(eveTool).toContain("../../server/operon/email-flow");
  expect(eveTool).not.toContain("@operon/runtime");
  expect(eveTool).not.toContain("better-auth");
  expect(eveTool).not.toContain("betterAuth");
});

it("does keep server/operon free of @operon/runtime", () => {
  const files = [
    "copy.ts",
    "mailbox.ts",
    "mcp-client.ts",
    "principal.ts",
    "public-mail.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(operonDir, file), "utf8");
    expect(source).not.toContain("@operon/runtime");
  }
});
