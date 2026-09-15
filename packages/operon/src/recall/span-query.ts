/**
 * Deterministic clause chunking for multi-topic lexical recall.
 *
 * Adapted from vellum-ai/vellum-assistant
 * `assistant/src/plugins/defaults/memory/v3/span-query.ts`
 * commit 4f7c8744acb4d7f4f7c6e8f1eacdf90538dfac2f
 * MIT License, Copyright (c) 2025 Vellum AI
 * (see `packages/operon/third-party/vellum-LICENSE.txt`).
 *
 * A single score over a long, multi-topic message averages distinct retrieval
 * intents. Chunking is pure text processing: split at newlines and sentence
 * punctuation, drop fragments below {@link MIN_SPAN_WEIGHT}. A message yielding
 * more than {@link MAX_SPAN_CHUNKS} spans is partitioned into that many
 * contiguous near-equal groups so the whole message stays covered.
 */

/** Hard cap on span chunks per message. */
export const MAX_SPAN_CHUNKS = 8;

/** Spans weighing less than this are dropped. Weight, not raw length. */
const MIN_SPAN_WEIGHT = 15;

const DENSE_SCRIPT = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u;

function spanWeight(span: string): number {
  let weight = 0;
  for (const ch of span) {
    weight += DENSE_SCRIPT.test(ch) ? 3 : 1;
  }
  return weight;
}

/**
 * Split `message` into at most {@link MAX_SPAN_CHUNKS} contiguous clause chunks.
 * Deterministic; returns `[]` for empty/whitespace input.
 */
export function spanChunksOf(message: string): string[] {
  const spans = message
    .split(/\n+|(?<=[\p{STerm}…])\s+|(?<=[。！？｡])/u)
    .map((s) => s.trim())
    .filter((s) => spanWeight(s) >= MIN_SPAN_WEIGHT);
  if (spans.length <= MAX_SPAN_CHUNKS) {
    return spans;
  }
  const chunks: string[] = [];
  for (let i = 0; i < MAX_SPAN_CHUNKS; i++) {
    const lo = Math.floor((i * spans.length) / MAX_SPAN_CHUNKS);
    const hi = Math.floor(((i + 1) * spans.length) / MAX_SPAN_CHUNKS);
    if (hi > lo) {
      chunks.push(spans.slice(lo, hi).join(" "));
    }
  }
  return chunks;
}
