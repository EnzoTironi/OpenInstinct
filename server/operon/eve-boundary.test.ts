import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const eveTool = readFileSync(
  join(here, "../../agent/tools/operon-email.ts"),
  "utf8"
);
const operonDir = here;

it("does keep Eve free of @operon/runtime and a second Better Auth", () => {
  expect(eveTool).toContain("operon-email-quarantine");
  expect(eveTool).toContain("../../server/operon/qcl");
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
    "qcl.ts",
    "source-connection.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(operonDir, file), "utf8");
    expect(source, file).not.toContain("@operon/runtime");
  }
});
