import { Effect } from "effect";

import type {
  InMemoryAuthority,
  ObjectSnapshot,
  SourceOccurrence,
} from "../authority";
import { projectScopedSection, type ActionHostBinding } from "../catalog";
import { canonicalJson, computeCanonicalDigest } from "../digest";
import type { EvidenceObservation } from "../lifecycle";
import {
  selectRelevantContext,
  type RecallResult,
  type RecallSection,
  type RequiredEvidenceRequest,
} from "./select";

function tokenCostOf(body: string): number {
  return body.length < 4 ? 1 : (body.length + 3) >> 2;
}

function sectionBody(snapshot: ObjectSnapshot): string {
  return canonicalJson({
    body: snapshot.body,
    operationalStatus: snapshot.operationalStatus ?? null,
    typeId: snapshot.typeId,
  });
}

function cacheKey(
  host: ActionHostBinding,
  authorityGeneration: number,
  query: string,
  requiredEvidence: readonly RequiredEvidenceRequest[]
): string {
  return computeCanonicalDigest({
    authorityGeneration,
    query,
    requiredEvidence: requiredEvidence.map((row) => ({
      id: row.id,
      objectId: row.objectId,
    })),
    userId: host.userId,
    workspaceId: host.workspaceId,
  });
}

/**
 * Project one host-owned Operon object into a recall section. Audience is the
 * host principal, not a shared role label.
 */
export function projectObjectSection(
  snapshot: ObjectSnapshot,
  host: ActionHostBinding,
  authorityGeneration: number
): RecallSection {
  const scoped = projectScopedSection(
    {
      id: `${snapshot.id}:${snapshot.revision}`,
      objectId: snapshot.id,
      revision: snapshot.revision,
    },
    host
  );
  const body = sectionBody(snapshot);
  const visible =
    snapshot.eligibility === "eligible" || snapshot.eligibility === "pruned"
      ? body
      : "";
  return {
    audience: host.userId,
    authorityGeneration,
    body: visible,
    eligibility: snapshot.eligibility,
    id: scoped.sourceId,
    objectId: scoped.objectId,
    revision: scoped.revision,
    title: snapshot.typeId,
    tokenCost: tokenCostOf(visible),
  };
}

/**
 * Count independent sources. Quoted or forwarded copies of one provider id
 * are one corroborating source, not many.
 */
export function corroboratingProviderIds(
  sources: readonly SourceOccurrence[]
): readonly string[] {
  const originals = new Set<string>();
  for (const source of sources) {
    originals.add(
      source.metadata.quotedFrom ??
        source.metadata.forwardedFrom ??
        source.providerId
    );
  }
  return [...originals].toSorted();
}

export function evidenceObservationsFromRecall(
  dispositions: RecallResult["requiredEvidence"]
): EvidenceObservation[] {
  return dispositions.map((row) => {
    switch (row.status) {
      case "available":
        return { kind: "present", name: row.id };
      case "missing":
        return { kind: "absent", name: row.id };
      case "ineligible":
        return { kind: "inaccessible", name: row.id };
      default: {
        const unexpected: never = row.status;
        return unexpected;
      }
    }
  });
}

interface CachedRecall {
  readonly generation: number;
  readonly host: ActionHostBinding;
  readonly result: RecallResult;
}

export class HostScopedRecallCache {
  readonly #entries = new Map<string, CachedRecall>();

  read(
    host: ActionHostBinding,
    authorityGeneration: number,
    query: string,
    requiredEvidence: readonly RequiredEvidenceRequest[]
  ): RecallResult | undefined {
    const entry = this.#entries.get(
      cacheKey(host, authorityGeneration, query, requiredEvidence)
    );
    if (!entry) {
      return undefined;
    }
    if (
      entry.host.userId !== host.userId ||
      entry.host.workspaceId !== host.workspaceId ||
      entry.generation !== authorityGeneration
    ) {
      return undefined;
    }
    return entry.result;
  }

  write(
    host: ActionHostBinding,
    authorityGeneration: number,
    query: string,
    requiredEvidence: readonly RequiredEvidenceRequest[],
    result: RecallResult
  ): void {
    this.#entries.set(
      cacheKey(host, authorityGeneration, query, requiredEvidence),
      { generation: authorityGeneration, host, result }
    );
  }
}

export const selectHostScopedContext = Effect.fn("selectHostScopedContext")(
  function* (
    authority: InMemoryAuthority,
    cache: HostScopedRecallCache,
    host: ActionHostBinding,
    query: string,
    requiredEvidence: readonly RequiredEvidenceRequest[],
    budgetTokens: number,
    authorityGeneration: number,
    orderedReferents: readonly string[]
  ) {
    const cached = cache.read(
      host,
      authorityGeneration,
      query,
      requiredEvidence
    );
    if (cached) {
      return cached;
    }
    const snapshots = yield* authority.listObjects(host);
    const sections = snapshots.map((snapshot) =>
      projectObjectSection(snapshot, host, authorityGeneration)
    );
    const result = selectRelevantContext({
      audience: host.userId,
      budgetTokens,
      currentAuthorityGeneration: authorityGeneration,
      orderedReferents:
        orderedReferents.length > 0 ? orderedReferents : undefined,
      query,
      requiredEvidence,
      sections,
    });
    cache.write(host, authorityGeneration, query, requiredEvidence, result);
    return result;
  }
);
