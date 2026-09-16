import { describe, expect, it } from "vitest";

import {
  evaluateSectionRecall,
  rankWholeDocument,
  type RecallEvaluationTask,
} from "./evaluate";
import type { RecallSection } from "./select";

function section(
  partial: Pick<RecallSection, "id" | "objectId" | "title" | "body"> &
    Partial<RecallSection>
): RecallSection {
  return {
    audience: "owner",
    authorityGeneration: 1,
    eligibility: "eligible",
    revision: "1",
    tokenCost: 8,
    ...partial,
  };
}

const corpus: RecallSection[] = [
  section({
    body: "first option is the green draft",
    id: "opt-1",
    objectId: "opt-1",
    title: "Green",
  }),
  section({
    body: "second option is the red draft",
    id: "opt-2",
    objectId: "opt-2",
    title: "Red",
  }),
  section({
    body: "old hallway discussion about neither draft",
    id: "opt-old",
    objectId: "opt-old",
    title: "Hallway",
  }),
  section({
    body: `${"tomatoes basil watering ".repeat(40)} end of garden chatter.`,
    id: "garden-long",
    objectId: "garden-long",
    title: "Garden watering tomatoes basil",
    tokenCost: 40,
  }),
  section({
    body: "Deadline is Friday at 17:00 for the signed brief.",
    id: "deadline-late",
    objectId: "deadline-late",
    title: "Deadline",
    tokenCost: 6,
  }),
  section({
    body: "vault handle for the shared login",
    id: "vault-evidence",
    objectId: "vault",
    title: "Vault",
    tokenCost: 40,
  }),
  ...Array.from({ length: 8 }, (_, index) =>
    section({
      body: `common brief language filler ${String(index)} about the Q3 brief wording`,
      id: `noise-${String(index)}`,
      objectId: `noise-${String(index)}`,
      title: "Brief wording",
      tokenCost: 10,
    })
  ),
  section({
    body: "Stale claim that the brief is still green.",
    id: "color-old",
    objectId: "color",
    revision: "1",
    title: "Color old",
  }),
  section({
    body: "Corrected claim that the brief is red.",
    id: "color-new",
    objectId: "color",
    revision: "2",
    title: "Color current",
  }),
  section({
    body: "Private salary number 180000 that another audience must not see.",
    id: "salary",
    objectId: "salary",
    title: "Compensation",
  }),
  section({
    body: "Forgotten home address on Rua Exemplo.",
    eligibility: "forgotten",
    id: "address",
    objectId: "address",
    title: "Address",
  }),
  section({
    body: "这是消息里的第一句完整的话。截止日期是星期五。",
    id: "cjk-deadline",
    objectId: "cjk-deadline",
    title: "期限",
  }),
];

const tasks: readonly RecallEvaluationTask[] = [
  {
    audience: "owner",
    budgetTokens: 64,
    expectedIds: ["opt-2"],
    forbiddenIds: ["opt-old"],
    id: "reference-only",
    orderedReferents: ["opt-1", "opt-2", "opt-old"],
    query: "Use the second one",
    requiredEvidence: [],
  },
  {
    audience: "owner",
    budgetTokens: 64,
    expectedIds: ["opt-2"],
    forbiddenIds: ["opt-old"],
    id: "reference-only-pt",
    orderedReferents: ["opt-1", "opt-2", "opt-old"],
    query: "Use o segundo",
    requiredEvidence: [],
  },
  {
    audience: "owner",
    budgetTokens: 64,
    expectedIds: ["deadline-late"],
    forbiddenIds: [],
    id: "multi-topic",
    query:
      "Please water the tomatoes and basil this week. Also the deadline is Friday.",
    requiredEvidence: [],
  },
  {
    audience: "owner",
    budgetTokens: 64,
    expectedIds: [],
    forbiddenIds: [],
    id: "sparse",
    query: "anything at all about Ana",
    requiredEvidence: [{ id: "rd-ana", objectId: "missing-object" }],
  },
  {
    audience: "owner",
    budgetTokens: 12,
    expectedIds: ["vault-evidence"],
    forbiddenIds: [],
    id: "required-over-budget",
    query: "Q3 brief wording",
    requiredEvidence: [{ id: "rd-vault", objectId: "vault" }],
  },
  {
    audience: "owner",
    budgetTokens: 64,
    expectedIds: ["color-new"],
    forbiddenIds: ["color-old"],
    id: "changed-fact",
    query: "brief is red green color",
    requiredEvidence: [],
  },
  {
    audience: "helper",
    budgetTokens: 64,
    expectedIds: [],
    forbiddenIds: ["salary", "address"],
    id: "unauthorized",
    query: "salary compensation 180000 address Rua Exemplo",
    requiredEvidence: [],
  },
  {
    audience: "owner",
    budgetTokens: 64,
    expectedIds: ["cjk-deadline"],
    forbiddenIds: [],
    id: "cjk-span",
    query: "截止日期是星期五",
    requiredEvidence: [],
  },
];

describe("evaluateSectionRecall", () => {
  it("does beat whole-document ranking on the lean section tasks without model cost", () => {
    const report = evaluateSectionRecall(corpus, tasks);
    expect(report.modelCalls).toBe(0);
    expect(report.embedCalls).toBe(0);
    expect(report.totalCostUsd).toBe(0);
    expect(report.privacyFailures).toBe(0);
    expect(report.requiredEvidenceDropped).toBe(0);
    expect(report.incorrectOrStaleRecall).toBe(0);
    expect(report.selectorHits).toBe(report.taskCount);
    expect(report.meanLatencyMs).toBeLessThan(50);
    const multiTopic = report.tasks.find((row) => row.id === "multi-topic");
    expect(multiTopic?.expectedHit).toBe(true);
    expect(multiTopic?.baselineHit).toBe(false);
    const required = report.tasks.find(
      (row) => row.id === "required-over-budget"
    );
    expect(required?.expectedHit).toBe(true);
    expect(required?.requiredDropped).toBe(false);
  });

  it("does keep the whole-document baseline from selecting the late deadline", () => {
    const noisy = corpus.filter(
      (item) => item.id === "garden-long" || item.id === "deadline-late"
    );
    expect(
      rankWholeDocument(
        noisy,
        "Please water the tomatoes and basil this week. Also the deadline is Friday.",
        "owner"
      )
    ).toEqual(["garden-long"]);
  });
});
