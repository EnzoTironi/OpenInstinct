import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import {
  emailConnect,
  emailRegister,
  emailSearch,
  emailSync,
} from "@agent/tools/email-quarantine";
import { expect, it } from "vitest";

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
