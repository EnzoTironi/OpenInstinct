import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  addReactionToMessageOutputSchema,
  reactionTextFor,
  reactToMessageOutputSchema,
  reactToMessageToolResultSchema,
} from "./reaction";

const decodeReactToMessageToolResultSchema = Schema.decodeUnknownSync(
  reactToMessageToolResultSchema
);

const decodeReactToMessageToolResultSchema2 = Schema.decodeUnknownResult(
  reactToMessageToolResultSchema
);

const decodeReactToMessageOutputSchema = Schema.decodeUnknownSync(
  reactToMessageOutputSchema
);

const decodeAddReactionToMessageOutputSchema = Schema.decodeUnknownSync(
  addReactionToMessageOutputSchema
);

const decodeReactToMessageOutputSchema2 = Schema.decodeUnknownResult(
  reactToMessageOutputSchema
);

const decodeAddReactionToMessageOutputSchema2 = Schema.decodeUnknownResult(
  addReactionToMessageOutputSchema
);

const reactions = [
  ["thumbs_up", "👍"],
  ["thumbs_down", "👎"],
  ["heart", "❤️"],
  ["laugh", "😂"],
  ["exclamation", "‼️"],
  ["question", "❓"],
] as const;

describe("reaction contract", () => {
  it("defaults only omitted operation and rejects explicit undefined or null", () => {
    for (const [decodeSync, decodeResult] of [
      [decodeReactToMessageOutputSchema, decodeReactToMessageOutputSchema2],
      [
        decodeAddReactionToMessageOutputSchema,
        decodeAddReactionToMessageOutputSchema2,
      ],
    ] as const) {
      expect(decodeSync({ type: "heart" })).toEqual({
        type: "heart",
        operation: "add",
      });

      for (const operation of [undefined, null]) {
        expect(
          Result.isFailure(decodeResult({ type: "heart", operation }))
        ).toBe(true);
      }
    }

    expect(
      decodeReactToMessageToolResultSchema({
        kind: "tool-result",
        toolName: "react_to_message",
        output: { type: "heart" },
      })
    ).toEqual({
      kind: "tool-result",
      toolName: "react_to_message",
      output: { type: "heart", operation: "add" },
    });

    for (const operation of [undefined, null]) {
      expect(
        Result.isFailure(
          decodeReactToMessageToolResultSchema2({
            kind: "tool-result",
            toolName: "react_to_message",
            output: { type: "heart", operation },
          })
        )
      ).toBe(true);
    }
  });
  it.each(reactions)("preserves %s and its display text", (type, text) => {
    expect(reactionTextFor(type)).toBe(text);
    expect(decodeReactToMessageOutputSchema({ type })).toEqual({
      operation: "add",
      type,
    });
    expect(decodeAddReactionToMessageOutputSchema({ type })).toEqual({
      operation: "add",
      type,
    });

    for (const operation of ["add", "remove"]) {
      expect(
        decodeReactToMessageOutputSchema({
          type,
          operation,
          extra: true,
        })
      ).toEqual({ type, operation });
    }
  });

  it.each([
    null,
    {},
    { type: null },
    { type: "HEART" },
    { type: " heart " },
    { type: "heart", operation: null },
    { type: "heart", operation: "" },
    { type: "heart", operation: "replace" },
    { type: 1 },
    [],
  ])("rejects invalid input %j", (input) => {
    expect(Result.isSuccess(decodeReactToMessageOutputSchema2(input))).toBe(
      false
    );
    expect(
      Result.isSuccess(decodeAddReactionToMessageOutputSchema2(input))
    ).toBe(false);
  });

  it("only allows add on the web contract", () => {
    expect(
      Result.isSuccess(
        decodeAddReactionToMessageOutputSchema2({
          type: "heart",
          operation: "remove",
        })
      )
    ).toBe(false);
    expect(
      decodeAddReactionToMessageOutputSchema({
        type: "heart",
        operation: "add",
        extra: true,
      })
    ).toEqual({ type: "heart", operation: "add" });
  });

  it("strips envelope and output extras and defaults the nested operation", () => {
    expect(
      decodeReactToMessageToolResultSchema({
        kind: "tool-result",
        toolName: "react_to_message",
        callId: "c",
        output: { type: "heart", extra: true },
      })
    ).toEqual({
      kind: "tool-result",
      toolName: "react_to_message",
      output: { type: "heart", operation: "add" },
    });

    for (const input of [
      {
        kind: "other",
        toolName: "react_to_message",
        output: { type: "heart" },
      },
      { kind: "tool-result", toolName: "other", output: { type: "heart" } },
      { kind: "tool-result", toolName: "react_to_message", output: null },
    ]) {
      expect(
        Result.isSuccess(decodeReactToMessageToolResultSchema2(input))
      ).toBe(false);
    }
  });
});
