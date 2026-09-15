import { describe, expect, it } from "vitest";

import { buildSectionNeedle } from "./section-needle";

describe("buildSectionNeedle", () => {
  it("does rank the section that actually holds the term", () => {
    const needle = buildSectionNeedle([
      {
        body: "general background prose",
        head: "page-a - Intro",
        id: "intro",
        objectId: "page-a",
        ordinal: 0,
      },
      {
        body: "the elephant appears only here",
        head: "page-a - Details",
        id: "details",
        objectId: "page-a",
        ordinal: 1,
      },
      {
        body: "unrelated material about gardens",
        head: "topic-x - Notes",
        id: "notes",
        objectId: "topic-x",
        ordinal: 0,
      },
    ]);

    const results = needle.queryScored("elephant", 5);
    expect(results[0]?.id).toBe("details");
  });

  it("does weigh a heading match above the same term in body", () => {
    const needle = buildSectionNeedle([
      {
        body: "mention of zebra in passing",
        head: "alpha - Background",
        id: "body-hit",
        objectId: "alpha",
        ordinal: 0,
      },
      {
        body: "unrelated filler text about gardens",
        head: "beta - Zebra notes",
        id: "head-hit",
        objectId: "beta",
        ordinal: 0,
      },
    ]);

    expect(needle.queryScored("zebra", 2)[0]?.id).toBe("head-hit");
  });
});
