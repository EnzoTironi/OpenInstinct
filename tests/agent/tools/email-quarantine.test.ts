import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import {
  emailConnect,
  emailRegister,
  emailSearch,
  emailSync,
} from "@agent/tools/email-quarantine";
import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

it("does gate register on approval and leaves connect, sync, and search open", () => {
  expect(emailConnect.approval).toBeUndefined();
  expect(emailSearch.approval).toBeUndefined();
  expect(emailSync.approval).toBeUndefined();
  const approval = emailRegister.approval;
  expect(approval).toBeDefined();
  if (!approval || !("request" in approval)) {
    throw new Error("email-register requires request and response policies.");
  }
  expect(approval.response).toBe(authorizeApprovalResponse);
});

it("does keep Eve Consumer and bind register to an explicit confirm", () => {
  const source = readFileSync(
    join(here, "../../../agent/tools/email-quarantine.ts"),
    "utf8"
  );
  expect(source).toContain('role: "consumer"');
  expect(source).toContain("confirm: true");
  expect(source).toContain("sessionToken");
  expect(source).not.toContain("operon approver session");
});
