import { buildSectionNeedle } from "./section-needle";
import type { NeedleDocument } from "./section-needle";
import { spanChunksOf } from "./span-query";

export type SectionEligibility =
  | "eligible"
  | "pruned"
  | "forgotten"
  | "unauthorized"
  | "withdrawn";

export type RecallLane = "referent" | "lexical" | "span" | "required-evidence";

export type RecallProfile = "lean" | "measured-full";

export type RequiredEvidenceStatus = "available" | "missing" | "ineligible";

export interface RecallSection {
  readonly id: string;
  readonly objectId: string;
  readonly revision: string;
  readonly authorityGeneration: number;
  readonly title: string;
  readonly body: string;
  readonly eligibility: SectionEligibility;
  readonly tokenCost: number;
  readonly audience: string;
}

export interface RequiredEvidenceRequest {
  readonly id: string;
  readonly objectId: string;
}

export interface SelectContextInput {
  readonly sections: readonly RecallSection[];
  readonly query: string;
  readonly requiredEvidence: readonly RequiredEvidenceRequest[];
  readonly budgetTokens: number;
  readonly currentAuthorityGeneration: number;
  readonly audience: string;
  readonly orderedReferents?: readonly string[];
}

export interface RequiredEvidenceDisposition {
  readonly id: string;
  readonly objectId: string;
  readonly status: RequiredEvidenceStatus;
  readonly sectionId?: string;
}

export interface SelectedSection {
  readonly section: RecallSection;
  readonly score: number;
  readonly lane: RecallLane;
  readonly withinBudget: boolean;
}

export interface RecallResult {
  readonly relevant: readonly SelectedSection[];
  readonly requiredEvidence: readonly RequiredEvidenceDisposition[];
  readonly profile: RecallProfile;
  readonly modelCalls: 0;
  readonly embedCalls: 0;
  readonly lexicalQueries: number;
  readonly createdLinks: readonly [];
}

/**
 * Borrowed principle, not Vellum's page-count of ten. Below this many
 * selectable sections, skip work that would only pay off on a larger corpus.
 * Dense retrieval and selector-model calls are not implemented in this slice.
 */
export const LEAN_SECTION_THRESHOLD = 32;

const REFERENCE_ONLY =
  /^(?:use |usa |use [ao] |usa [ao] )?(?:the )?(?:first|second|third|primeiro|primeira|segundo|segunda|terceiro|terceira)(?: one)?\.?$/iu;

const ORDINAL_INDEX: readonly {
  readonly pattern: RegExp;
  readonly index: number;
}[] = [
  {
    pattern: /\b(?:first|primeiro|primeira)\b/iu,
    index: 0,
  },
  {
    pattern: /\b(?:second|segundo|segunda)\b/iu,
    index: 1,
  },
  {
    pattern: /\b(?:third|terceiro|terceira)\b/iu,
    index: 2,
  },
];

export function resolveRecallProfile(
  selectableSectionCount: number
): RecallProfile {
  return selectableSectionCount < LEAN_SECTION_THRESHOLD
    ? "lean"
    : "measured-full";
}

export function isSelectable(eligibility: SectionEligibility): boolean {
  switch (eligibility) {
    case "eligible":
    case "pruned":
      return true;
    case "forgotten":
    case "unauthorized":
    case "withdrawn":
      return false;
    default: {
      const exhaustive: never = eligibility;
      return exhaustive;
    }
  }
}

export function isReferenceOnlyQuery(query: string): boolean {
  return REFERENCE_ONLY.test(query.trim());
}

function compareRevision(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function currentRevisionSections(
  sections: readonly RecallSection[]
): RecallSection[] {
  const newest = new Map<string, string>();
  for (const section of sections) {
    const current = newest.get(section.objectId);
    if (!current || compareRevision(section.revision, current) > 0) {
      newest.set(section.objectId, section.revision);
    }
  }
  return sections.filter(
    (section) => newest.get(section.objectId) === section.revision
  );
}

function toNeedleDocument(
  section: RecallSection,
  ordinal: number
): NeedleDocument {
  return {
    body: section.body,
    head: `${section.objectId} - ${section.title}`,
    id: section.id,
    objectId: section.objectId,
    ordinal,
  };
}

function mergeScores(
  hits: readonly {
    readonly id: string;
    readonly score: number;
    readonly lane: RecallLane;
  }[]
): Map<string, { score: number; lane: RecallLane }> {
  const merged = new Map<string, { score: number; lane: RecallLane }>();
  for (const hit of hits) {
    const existing = merged.get(hit.id);
    if (!existing || hit.score > existing.score) {
      merged.set(hit.id, { lane: hit.lane, score: hit.score });
    }
  }
  return merged;
}

function ordinalIndex(query: string): number | undefined {
  for (const entry of ORDINAL_INDEX) {
    if (entry.pattern.test(query)) {
      return entry.index;
    }
  }
  return undefined;
}

/**
 * Select relevant sections and resolve required evidence without embeddings
 * or a selector model. Does not create domain Links.
 *
 * @param input Authorized corpus already scoped by the host. This function
 *   does not fetch records or consult Mem0.
 */
export function selectRelevantContext(input: SelectContextInput): RecallResult {
  const selectable = currentRevisionSections(
    input.sections.filter(
      (section) =>
        isSelectable(section.eligibility) &&
        section.audience === input.audience &&
        section.authorityGeneration === input.currentAuthorityGeneration
    )
  );
  const profile = resolveRecallProfile(selectable.length);
  const byId = new Map(selectable.map((section) => [section.id, section]));
  const byObject = new Map(
    selectable.map((section) => [section.objectId, section])
  );

  const requiredEvidence: RequiredEvidenceDisposition[] =
    input.requiredEvidence.map((request) => {
      const matches = input.sections.filter(
        (section) => section.objectId === request.objectId
      );
      if (matches.length === 0) {
        return {
          id: request.id,
          objectId: request.objectId,
          status: "missing",
        };
      }
      const current = byObject.get(request.objectId);
      if (!current) {
        return {
          id: request.id,
          objectId: request.objectId,
          sectionId: matches[0]?.id,
          status: "ineligible",
        };
      }
      return {
        id: request.id,
        objectId: request.objectId,
        sectionId: current.id,
        status: "available",
      };
    });

  let lexicalQueries = 0;
  const scoredHits: {
    readonly id: string;
    readonly score: number;
    readonly lane: RecallLane;
  }[] = [];

  if (isReferenceOnlyQuery(input.query) && input.orderedReferents) {
    const index = ordinalIndex(input.query);
    if (index !== undefined) {
      const referentId = input.orderedReferents[index];
      if (referentId && byId.has(referentId)) {
        scoredHits.push({ id: referentId, lane: "referent", score: 1 });
      }
    }
  } else if (selectable.length > 0) {
    const needle = buildSectionNeedle(
      selectable.map((section, ordinal) => toNeedleDocument(section, ordinal))
    );
    const queries = [input.query, ...spanChunksOf(input.query)].filter(
      (text, index, all) => all.indexOf(text) === index
    );
    for (const [index, text] of queries.entries()) {
      lexicalQueries += 1;
      const lane: RecallLane = index === 0 ? "lexical" : "span";
      for (const hit of needle.queryScored(text, selectable.length)) {
        scoredHits.push({ id: hit.id, lane, score: hit.score });
      }
    }
  }

  for (const disposition of requiredEvidence) {
    if (disposition.status === "available" && disposition.sectionId) {
      scoredHits.push({
        id: disposition.sectionId,
        lane: "required-evidence",
        score: 0,
      });
    }
  }

  const merged = mergeScores(scoredHits);
  const ranked = [...merged.entries()]
    .map(([id, value]) => {
      const section = byId.get(id);
      if (!section) {
        return undefined;
      }
      return { lane: value.lane, score: value.score, section };
    })
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.section.id.localeCompare(right.section.id)
    );

  const requiredIds = new Set(
    requiredEvidence
      .filter((disposition) => disposition.status === "available")
      .map((disposition) => disposition.sectionId)
      .filter((id): id is string => id !== undefined)
  );
  const relevant: SelectedSection[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const row of ranked) {
    if (seen.has(row.section.id)) {
      continue;
    }
    seen.add(row.section.id);
    const required = requiredIds.has(row.section.id);
    const fits = used + row.section.tokenCost <= input.budgetTokens;
    if (!fits && !required) {
      continue;
    }
    relevant.push({
      lane: row.lane,
      score: row.score,
      section: row.section,
      withinBudget: fits,
    });
    if (fits) {
      used += row.section.tokenCost;
    }
  }

  return {
    createdLinks: [],
    embedCalls: 0,
    lexicalQueries,
    modelCalls: 0,
    profile,
    relevant,
    requiredEvidence,
  };
}
