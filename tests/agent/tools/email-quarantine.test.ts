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
import type { ToolContext } from "eve/tools";
import { expect, it } from "vitest";
import { cardCopy, connectCopy } from "../../../server/operon/copy";

const here = dirname(fileURLToPath(import.meta.url));

function toolContext(): ToolContext {
  return {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    async getToken() {
      throw new Error("Token access is outside this focused test.");
    },
    requireAuth() {
      throw new Error("Authorization is outside this focused test.");
    },
    session: {
      auth: { current: null, initiator: null },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName: "email-connect",
  };
}

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
  expect(source).toContain("viewedProposalMatches");
  expect(source).toContain("stale_digest");
  expect(source).toContain('role: "consumer"');
  expect(source).toContain("confirm: true");
  expect(source).toContain("sessionToken");
  expect(source).not.toContain("quarantineCardMessage");
  expect(source).not.toContain("operon approver session");
  expect(source).not.toContain("@operon/runtime");
  expect(source).not.toContain("ontologia");
});

it("does return the host connect copy", async () => {
  expect(await emailConnect.execute({}, toolContext())).toEqual({
    message: connectCopy,
  });
  expect(connectCopy).toBe(
    "Vou ler sua caixa para mostrar com quem você fala. Não vou mandar e-mail. Não vou alterar a agenda."
  );
});

it("does reject register without a matching pending digest", async () => {
  await expect(
    emailRegister.execute(
      {
        approvalMessage: "Eve inventou outro texto para o humano.",
        viewedDigest: "a".repeat(64),
        card: cardCopy(3, 3, 1, 0),
      },
      { ...toolContext(), toolName: "email-register" }
    )
  ).rejects.toMatchObject({ reason: "stale_digest" });
});
