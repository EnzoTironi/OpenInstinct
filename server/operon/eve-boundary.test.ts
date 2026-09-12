import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const eveTool = readFileSync(
  join(here, "../../agent/tools/email-quarantine.ts"),
  "utf8"
);
const operonDir = here;

it("does keep Eve free of @operon/runtime and a second Better Auth", () => {
  expect(eveTool).toContain("email-register");
  expect(eveTool).toContain("../../server/operon/email-flow");
  expect(eveTool).not.toContain("@operon/runtime");
  expect(eveTool).not.toContain("better-auth");
  expect(eveTool).not.toContain("betterAuth");
  expect(eveTool).not.toContain("operon approver session");
  expect(eveTool).toContain('role: "consumer"');
});

it("does keep server/operon free of @operon/runtime", () => {
  const files = [
    "copy.ts",
    "email-flow.ts",
    "mailbox.ts",
    "mcp-client.ts",
    "principal.ts",
    "public-mail.ts",
    "quarantine-card.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(operonDir, file), "utf8");
    expect(source).not.toContain("@operon/runtime");
    expect(source).not.toContain("operon approver session");
  }
});

it("does spawn MCP with the session token instead of operon approver session", () => {
  const source = readFileSync(join(operonDir, "mcp-client.ts"), "utf8");
  expect(source).toContain("OPERON_APPROVER_SESSION_TOKEN");
  expect(source).toContain("sessionToken");
  expect(source).not.toContain("--host-approver");
  expect(source).not.toContain("approver session");
});
