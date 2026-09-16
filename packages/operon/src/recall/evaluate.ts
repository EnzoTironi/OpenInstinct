import { tokenizeUnigrams } from "./section-needle";
import {
  selectRelevantContext,
  type RecallResult,
  type RecallSection,
  type RequiredEvidenceRequest,
  type SelectContextInput,
} from "./select";

export interface RecallEvaluationTask {
  readonly id: string;
  readonly query: string;
  readonly expectedIds: readonly string[];
  readonly forbiddenIds: readonly string[];
  readonly requiredEvidence: readonly RequiredEvidenceRequest[];
  readonly audience: string;
  readonly budgetTokens: number;
  readonly orderedReferents?: readonly string[];
}

export interface RecallTaskComparison {
  readonly id: string;
  readonly expectedHit: boolean;
  readonly baselineHit: boolean;
  readonly privacyFailure: boolean;
  readonly staleRecall: boolean;
  readonly requiredDropped: boolean;
  readonly latencyMs: number;
  readonly modelCalls: 0;
  readonly embedCalls: 0;
}

export interface RecallEvaluationReport {
  readonly taskCount: number;
  readonly selectorHits: number;
  readonly baselineHits: number;
  readonly incorrectOrStaleRecall: number;
  readonly privacyFailures: number;
  readonly requiredEvidenceDropped: number;
  readonly meanLatencyMs: number;
  readonly modelCalls: 0;
  readonly embedCalls: 0;
  readonly totalCostUsd: 0;
  readonly tasks: readonly RecallTaskComparison[];
}

function currentRevisionId(
  sections: readonly RecallSection[],
  objectId: string
): string | undefined {
  let newest: RecallSection | undefined;
  for (const section of sections) {
    if (section.objectId !== objectId) {
      continue;
    }
    if (
      !newest ||
      Number(section.revision) > Number(newest.revision) ||
      (section.revision === newest.revision &&
        section.id.localeCompare(newest.id) > 0)
    ) {
      newest = section;
    }
  }
  return newest?.id;
}

/**
 * Whole-object ranking used only as the before/after baseline. It is not a
 * production retrieval path and does not union required evidence.
 */
export function rankWholeDocument(
  sections: readonly RecallSection[],
  query: string,
  audience: string
): string[] {
  const terms = new Set(tokenizeUnigrams(query));
  const grouped = new Map<string, RecallSection[]>();
  for (const section of sections) {
    if (section.audience !== audience) {
      continue;
    }
    const list = grouped.get(section.objectId) ?? [];
    list.push(section);
    grouped.set(section.objectId, list);
  }
  const scored = [...grouped.entries()].map(([objectId, group]) => {
    const blob = group.map((item) => `${item.title} ${item.body}`).join(" ");
    const score = tokenizeUnigrams(blob).filter((term) =>
      terms.has(term)
    ).length;
    return { ids: group.map((item) => item.id), objectId, score };
  });
  const ranked = scored.toSorted(
    (left, right) =>
      right.score - left.score || left.objectId.localeCompare(right.objectId)
  );
  const winner = ranked.find((row) => row.score > 0);
  return winner ? [...winner.ids] : [];
}

function selectedIds(result: RecallResult): string[] {
  return result.relevant.map((row) => row.section.id);
}

function requiredDropped(result: RecallResult): boolean {
  const selected = new Set(selectedIds(result));
  return result.requiredEvidence.some(
    (row) =>
      row.status === "available" &&
      row.sectionId !== undefined &&
      !selected.has(row.sectionId)
  );
}

function compareTask(
  sections: readonly RecallSection[],
  task: RecallEvaluationTask,
  authorityGeneration: number
): RecallTaskComparison {
  const input: SelectContextInput = {
    audience: task.audience,
    budgetTokens: task.budgetTokens,
    currentAuthorityGeneration: authorityGeneration,
    orderedReferents: task.orderedReferents,
    query: task.query,
    requiredEvidence: task.requiredEvidence,
    sections,
  };
  const started = performance.now();
  const after = selectRelevantContext(input);
  const latencyMs = performance.now() - started;
  const beforeIds = rankWholeDocument(sections, task.query, task.audience);
  const afterIds = selectedIds(after);
  const expectedHit =
    task.expectedIds.length === 0 ||
    task.expectedIds.every((id) => afterIds.includes(id));
  const baselineHit =
    task.expectedIds.length === 0 ||
    task.expectedIds.every((id) => beforeIds.includes(id));
  const privacyFailure = task.forbiddenIds.some((id) => afterIds.includes(id));
  let staleRecall = false;
  for (const id of afterIds) {
    const section = sections.find((item) => item.id === id);
    if (!section) {
      continue;
    }
    const current = currentRevisionId(sections, section.objectId);
    if (current && current !== section.id) {
      staleRecall = true;
    }
  }
  return {
    baselineHit,
    embedCalls: 0,
    expectedHit,
    id: task.id,
    latencyMs,
    modelCalls: 0,
    privacyFailure,
    requiredDropped: requiredDropped(after),
    staleRecall,
  };
}

/**
 * Compare section-aware selection with whole-document ranking on one corpus.
 * Does not call a model or write memory.
 */
export function evaluateSectionRecall(
  sections: readonly RecallSection[],
  tasks: readonly RecallEvaluationTask[],
  currentAuthorityGeneration = 1
): RecallEvaluationReport {
  const comparisons = tasks.map((task) =>
    compareTask(sections, task, currentAuthorityGeneration)
  );
  const meanLatencyMs =
    comparisons.length === 0
      ? 0
      : comparisons.reduce((sum, row) => sum + row.latencyMs, 0) /
        comparisons.length;
  return {
    baselineHits: comparisons.filter((row) => row.baselineHit).length,
    embedCalls: 0,
    incorrectOrStaleRecall: comparisons.filter(
      (row) => row.staleRecall || !row.expectedHit
    ).length,
    meanLatencyMs,
    modelCalls: 0,
    privacyFailures: comparisons.filter((row) => row.privacyFailure).length,
    requiredEvidenceDropped: comparisons.filter((row) => row.requiredDropped)
      .length,
    selectorHits: comparisons.filter((row) => row.expectedHit).length,
    taskCount: comparisons.length,
    tasks: comparisons,
    totalCostUsd: 0,
  };
}
