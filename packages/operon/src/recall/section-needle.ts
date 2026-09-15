/**
 * Section-grain BM25F lexical scoring.
 *
 * Adapted from vellum-ai/vellum-assistant
 * `assistant/src/plugins/defaults/memory/v3/section-needle.ts`
 * commit 4f7c8744acb4d7f4f7c6e8f1eacdf90538dfac2f
 * MIT License, Copyright (c) 2025 Vellum AI
 * (see `packages/operon/third-party/vellum-LICENSE.txt`).
 *
 * Hand-rolled Okapi BM25F over a bounded in-memory section corpus. No Qdrant,
 * embeddings, or assistant framework. Tokenizer includes Unicode letters so
 * Portuguese and CJK unigrams index; that is a Zoen adaptation of the ASCII
 * upstream tokenizer.
 */

const k1 = 1.5;
const b = 0.75;
const HEAD_WEIGHT = 2.5;
const BODY_WEIGHT = 1;

const NON_TOKEN_RUN = /[^\p{L}\p{N}]+/u;

export interface NeedleDocument {
  readonly id: string;
  readonly objectId: string;
  readonly ordinal: number;
  readonly head: string;
  readonly body: string;
}

export interface NeedleHit {
  readonly id: string;
  readonly objectId: string;
  readonly score: number;
}

export function tokenizeUnigrams(text: string): string[] {
  return text
    .toLowerCase()
    .split(NON_TOKEN_RUN)
    .filter((token) => token.length > 0);
}

function tokenize(text: string): string[] {
  const unigrams = tokenizeUnigrams(text);
  const terms = [...unigrams];
  for (let i = 0; i + 1 < unigrams.length; i++) {
    const left = unigrams[i];
    const right = unigrams[i + 1];
    if (left && right) {
      terms.push(`${left}_${right}`);
    }
  }
  return terms;
}

interface Posting {
  doc: number;
  weightedTf: number;
}

export interface SectionNeedle {
  readonly queryScored: (text: string, k: number) => NeedleHit[];
}

export function buildSectionNeedle(
  documents: readonly NeedleDocument[]
): SectionNeedle {
  const docCount = documents.length;
  const postings = new Map<string, Posting[]>();
  const docLengths: number[] = [];
  let totalLength = 0;

  for (const [doc, document] of documents.entries()) {
    const headTerms = tokenize(document.head);
    const bodyTerms = tokenize(document.body);
    const length =
      HEAD_WEIGHT * headTerms.length + BODY_WEIGHT * bodyTerms.length;
    docLengths.push(length);
    totalLength += length;

    const weightedTf = new Map<string, number>();
    for (const term of headTerms) {
      weightedTf.set(term, (weightedTf.get(term) ?? 0) + HEAD_WEIGHT);
    }
    for (const term of bodyTerms) {
      weightedTf.set(term, (weightedTf.get(term) ?? 0) + BODY_WEIGHT);
    }
    for (const [term, tf] of weightedTf) {
      let list = postings.get(term);
      if (!list) {
        list = [];
        postings.set(term, list);
      }
      list.push({ doc, weightedTf: tf });
    }
  }

  const avgDocLength = docCount > 0 ? totalLength / docCount : 0;

  function idfFromDf(df: number): number {
    return Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
  }

  function termScore(doc: number, weightedTf: number, termIdf: number): number {
    const length = docLengths[doc] ?? 0;
    const norm = weightedTf * (k1 + 1);
    const denom =
      weightedTf + k1 * (1 - b + b * (length / (avgDocLength || 1)));
    return termIdf * (norm / denom);
  }

  function scoreSections(queryTerms: Set<string>): Map<number, number> {
    const scores = new Map<number, number>();
    if (docCount === 0) {
      return scores;
    }
    for (const term of queryTerms) {
      const list = postings.get(term);
      if (!list) {
        continue;
      }
      const termIdf = idfFromDf(list.length);
      for (const { doc, weightedTf } of list) {
        scores.set(
          doc,
          (scores.get(doc) ?? 0) + termScore(doc, weightedTf, termIdf)
        );
      }
    }
    return scores;
  }

  function rankSection(
    left: number,
    right: number,
    scores: Map<number, number>
  ): number {
    const byScore = (scores.get(right) ?? 0) - (scores.get(left) ?? 0);
    if (byScore !== 0) {
      return byScore;
    }
    const leftDoc = documents[left];
    const rightDoc = documents[right];
    if (!leftDoc || !rightDoc) {
      return left - right;
    }
    return (
      leftDoc.objectId.localeCompare(rightDoc.objectId) ||
      leftDoc.ordinal - rightDoc.ordinal ||
      leftDoc.id.localeCompare(rightDoc.id)
    );
  }

  function queryScored(text: string, k: number): NeedleHit[] {
    if (k <= 0 || docCount === 0) {
      return [];
    }
    const scores = scoreSections(new Set(tokenize(text)));
    if (scores.size === 0) {
      return [];
    }
    return [...scores.keys()]
      .toSorted((left, right) => rankSection(left, right, scores))
      .slice(0, k)
      .flatMap((doc) => {
        const document = documents[doc];
        if (!document) {
          return [];
        }
        return [
          {
            id: document.id,
            objectId: document.objectId,
            score: scores.get(doc) ?? 0,
          },
        ];
      });
  }

  return { queryScored };
}
