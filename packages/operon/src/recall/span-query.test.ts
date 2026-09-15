import { describe, expect, it } from "vitest";

import { MAX_SPAN_CHUNKS, spanChunksOf } from "./span-query";

describe("spanChunksOf", () => {
  it("does pass a short message through as clause spans", () => {
    expect(
      spanChunksOf("the first sentence is here. and a second sentence follows!")
    ).toEqual([
      "the first sentence is here.",
      "and a second sentence follows!",
    ]);
  });

  it("does split on newlines like sentence punctuation", () => {
    expect(
      spanChunksOf(
        "a line without terminal punctuation\nanother line of the message"
      )
    ).toEqual([
      "a line without terminal punctuation",
      "another line of the message",
    ]);
  });

  it("does drop fragments below the weight floor", () => {
    expect(spanChunksOf("ok. this sentence is long enough to keep.")).toEqual([
      "this sentence is long enough to keep.",
    ]);
  });

  it("does yield no chunks for empty or whitespace input", () => {
    expect(spanChunksOf("")).toEqual([]);
    expect(spanChunksOf("  \n\n  ")).toEqual([]);
  });

  it("does split fullwidth CJK terminators without trailing whitespace", () => {
    expect(
      spanChunksOf(
        "这是消息里的第一句完整的话。这是紧跟着的第二句完整的话！第三句也一样长够十五个字符？"
      )
    ).toEqual([
      "这是消息里的第一句完整的话。",
      "这是紧跟着的第二句完整的话！",
      "第三句也一样长够十五个字符？",
    ]);
  });

  it("does not split ASCII decimals", () => {
    expect(
      spanChunksOf("the value came out to 3.14159 in the final run.")
    ).toEqual(["the value came out to 3.14159 in the final run."]);
  });

  it("does merge over-cap messages into contiguous covering chunks", () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `sentence number ${i} padded for length.`
    );
    const chunks = spanChunksOf(sentences.join(" "));
    expect(chunks.length).toBe(MAX_SPAN_CHUNKS);
    expect(chunks.join(" ")).toBe(sentences.join(" "));
  });
});
