import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import type { ToolContext } from "eve/tools";
import { beforeEach, expect, it, vi } from "vitest";
import { cardCopy, connectCopy } from "../../../server/operon/copy";

const pendingControls = vi.hoisted(() => {
  const states = new Map<string, unknown>();
  const pendingKey = "zoen.email.pending-proposal";
  return {
    get() {
      return states.get(pendingKey) ?? null;
    },
    set(next: unknown) {
      states.set(pendingKey, next);
    },
    reset() {
      states.set(pendingKey, null);
    },
    defineState<T>(name: string, initial: () => T) {
      if (!states.has(name)) states.set(name, initial());
      return {
        get: () => states.get(name) as T,
        update(update: (current: T) => T) {
          states.set(name, update(states.get(name) as T));
        },
      };
    },
  };
});

vi.mock("eve/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("eve/context")>();
  return {
    ...actual,
    defineState: pendingControls.defineState,
  };
});

vi.mock("../../../server/runtime", () => ({
  serverRuntime: {
    runPromise() {
      return Promise.reject(new Error("confirm-reached"));
    },
  },
}));

import {
  emailConnect,
  emailRegister,
  emailSearch,
  emailSync,
} from "@agent/tools/email-quarantine";

const here = dirname(fileURLToPath(import.meta.url));
const digest = "a".repeat(64);
const card = cardCopy(3, 3, 1, 0);
const pending = {
  sessionId: "session-1",
  workspaceId: "workspace-1",
  proposalId: "proposal-1",
  digest,
  card,
};

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

beforeEach(() => {
  pendingControls.reset();
});

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
  pendingControls.set(pending);
  await expect(
    emailRegister.execute(
      {
        approvalMessage: "Eve inventou outro texto para o humano.",
        viewedDigest: "b".repeat(64),
        card,
      },
      { ...toolContext(), toolName: "email-register" }
    )
  ).rejects.toMatchObject({ reason: "stale_digest" });
});

it("does reject register when the viewed card does not match pending", async () => {
  pendingControls.set(pending);
  await expect(
    emailRegister.execute(
      {
        approvalMessage: "Eve inventou outro texto para o humano.",
        viewedDigest: digest,
        card: "4 conversas em quarentena, 4 pessoas, 1 empresas, 0 nomes em conflito.",
      },
      { ...toolContext(), toolName: "email-register" }
    )
  ).rejects.toMatchObject({ reason: "stale_digest" });
});

it("does not reject matching digest and card because Eve paraphrased", async () => {
  pendingControls.set(pending);
  const error = await emailRegister
    .execute(
      {
        approvalMessage: "Eve inventou outro texto para o humano.",
        viewedDigest: digest,
        card,
      },
      { ...toolContext(), toolName: "email-register" }
    )
    .then(
      () => undefined,
      (error: unknown) => error
    );
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toMatchObject({ reason: "stale_digest" });
  expect(String(error)).toContain("confirm-reached");
});
