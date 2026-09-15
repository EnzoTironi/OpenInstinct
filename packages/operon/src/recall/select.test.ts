import { describe, expect, it } from "vitest";

import { tokenizeUnigrams } from "./section-needle";
import {
  isReferenceOnlyQuery,
  isSelectable,
  LEAN_SECTION_THRESHOLD,
  resolveRecallProfile,
  selectRelevantContext,
  type RecallSection,
  type SelectContextInput,
} from "./select";

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

function select(
  sections: readonly RecallSection[],
  query: string,
  extra: Partial<SelectContextInput> = {}
) {
  return selectRelevantContext({
    audience: "owner",
    budgetTokens: 64,
    currentAuthorityGeneration: 1,
    query,
    requiredEvidence: [],
    sections,
    ...extra,
  });
}

function wholeDocumentTopId(
  sections: readonly RecallSection[],
  query: string
): string | undefined {
  const terms = new Set(tokenizeUnigrams(query));
  const grouped = new Map<string, RecallSection[]>();
  for (const item of sections) {
    const list = grouped.get(item.objectId) ?? [];
    list.push(item);
    grouped.set(item.objectId, list);
  }
  let bestId: string | undefined;
  let bestScore = 0;
  for (const [objectId, group] of grouped) {
    const blob = group.map((item) => `${item.title} ${item.body}`).join(" ");
    const score = tokenizeUnigrams(blob).filter((term) =>
      terms.has(term)
    ).length;
    if (score > bestScore) {
      bestScore = score;
      bestId = objectId;
    }
  }
  return bestId;
}

const corpus: RecallSection[] = [
  section({
    body: "Ana prefers the blue draft of the proposal from last March and discussed fonts at length.",
    id: "ana-old",
    objectId: "ana",
    title: "Earlier Ana notes",
  }),
  section({
    body: "Current authorized agreement with Ana: send the red revision of the Q3 brief.",
    id: "ana-current",
    objectId: "ana-current-agreement",
    title: "Current Ana agreement",
  }),
  section({
    body: "Garden watering schedule and unrelated recipe notes about tomatoes.",
    id: "garden",
    objectId: "garden",
    title: "Garden",
  }),
  section({
    body: "Deadline is Friday at 17:00 America/Sao_Paulo for the signed brief.",
    id: "deadline",
    objectId: "deadline",
    title: "Deadline",
    tokenCost: 6,
  }),
  section({
    body: "Private salary number 180000 that another audience must not see.",
    id: "salary",
    objectId: "salary",
    title: "Compensation",
    audience: "owner",
  }),
  section({
    body: "Withdrawn rumor that Ana left the company.",
    eligibility: "withdrawn",
    id: "rumor",
    objectId: "rumor",
    title: "Rumor",
  }),
  section({
    body: "Forgotten home address on Rua Exemplo.",
    eligibility: "forgotten",
    id: "address",
    objectId: "address",
    title: "Address",
  }),
  section({
    body: "Pruned but still authorized note that the courier is FlashLog.",
    eligibility: "pruned",
    id: "courier",
    objectId: "courier",
    title: "Courier",
  }),
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
];

describe("selectRelevantContext", () => {
  it("does resolve a reference-only reply to the authorized second referent", () => {
    const referents = [
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
    ];
    const started = performance.now();
    const result = select(referents, "Use the second one", {
      orderedReferents: ["opt-1", "opt-2", "opt-old"],
    });
    const latencyMs = performance.now() - started;
    expect(isReferenceOnlyQuery("Use the second one")).toBe(true);
    expect(result.relevant.map((row) => row.section.id)).toEqual(["opt-2"]);
    expect(result.modelCalls).toBe(0);
    expect(result.embedCalls).toBe(0);
    expect(result.createdLinks).toEqual([]);
    expect(latencyMs).toBeLessThan(50);
  });

  it("does resolve a Portuguese reference-only reply to the second referent", () => {
    const referents = [
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
    ];
    const result = select(referents, "Use o segundo", {
      orderedReferents: ["opt-1", "opt-2"],
    });
    expect(isReferenceOnlyQuery("Use o segundo")).toBe(true);
    expect(result.relevant.map((row) => row.section.id)).toEqual(["opt-2"]);
  });

  it("does keep a late multi-topic fact that whole-document ranking can bury", () => {
    const noisy = [
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
    ];
    const query =
      "Please water the tomatoes and basil this week. Also the deadline is Friday.";
    const before = wholeDocumentTopId(noisy, query);
    const after = select(noisy, query);
    expect(before).toBe("garden-long");
    expect(
      after.relevant.some((row) => row.section.id === "deadline-late")
    ).toBe(true);
    expect(after.embedCalls).toBe(0);
  });

  it("does stay lean on a sparse corpus and still report missing required evidence", () => {
    const result = select([], "anything at all about Ana", {
      requiredEvidence: [{ id: "rd-ana", objectId: "missing-object" }],
    });
    expect(result.profile).toBe("lean");
    expect(result.modelCalls).toBe(0);
    expect(result.embedCalls).toBe(0);
    expect(result.requiredEvidence[0]?.status).toBe("missing");
  });

  it("does keep required evidence that misses the ranking cutoff", () => {
    const distractors = Array.from({ length: 12 }, (_, index) =>
      section({
        body: `common brief language filler ${String(index)} about the Q3 brief wording`,
        id: `noise-${String(index)}`,
        objectId: `noise-${String(index)}`,
        title: "Brief wording",
        tokenCost: 10,
      })
    );
    const required = section({
      body: "vault handle for the shared login",
      id: "vault-evidence",
      objectId: "vault",
      title: "Vault",
      tokenCost: 40,
    });
    const result = select([...distractors, required], "Q3 brief wording", {
      budgetTokens: 12,
      requiredEvidence: [{ id: "rd-vault", objectId: "vault" }],
    });
    expect(result.requiredEvidence).toEqual([
      {
        id: "rd-vault",
        objectId: "vault",
        sectionId: "vault-evidence",
        status: "available",
      },
    ]);
    const requiredRow = result.relevant.find(
      (row) => row.section.id === "vault-evidence"
    );
    expect(requiredRow).toBeDefined();
    expect(requiredRow?.withinBudget).toBe(false);
  });

  it("does reselect pruned sections and exclude forgotten or withdrawn ones", () => {
    const result = select(corpus, "FlashLog courier address rumor");
    const ids = result.relevant.map((row) => row.section.id);
    expect(ids).toContain("courier");
    expect(ids).not.toContain("address");
    expect(ids).not.toContain("rumor");
  });

  it("does not promote co-selection into a domain Link", () => {
    const result = select(corpus, "Ana agreement Friday deadline");
    expect(result.relevant.length).toBeGreaterThan(1);
    expect(result.createdLinks).toEqual([]);
  });

  it("does hide another audience's private association", () => {
    const result = select(corpus, "salary compensation 180000", {
      audience: "helper",
    });
    expect(result.relevant.map((row) => row.section.id)).not.toContain(
      "salary"
    );
  });

  it("does prefer the current revision over a stale fact", () => {
    const result = select(corpus, "brief is red green color");
    const colorHits = result.relevant.filter(
      (row) => row.section.objectId === "color"
    );
    expect(colorHits.map((row) => row.section.id)).toEqual(["color-new"]);
  });

  it("does mark unauthorized required evidence ineligible rather than missing", () => {
    const result = select(
      [
        section({
          body: "secret contract clause",
          eligibility: "unauthorized",
          id: "secret",
          objectId: "secret",
          title: "Secret",
        }),
      ],
      "contract clause",
      { requiredEvidence: [{ id: "rd-secret", objectId: "secret" }] }
    );
    expect(result.requiredEvidence[0]?.status).toBe("ineligible");
    expect(result.relevant).toEqual([]);
  });

  it("does keep the lean profile below the measured-full threshold", () => {
    expect(resolveRecallProfile(0)).toBe("lean");
    expect(resolveRecallProfile(LEAN_SECTION_THRESHOLD - 1)).toBe("lean");
    expect(resolveRecallProfile(LEAN_SECTION_THRESHOLD)).toBe("measured-full");
    expect(isSelectable("pruned")).toBe(true);
    expect(isSelectable("forgotten")).toBe(false);
  });
});
