import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  addReactionToMessageOutputSchema,
  reactionTextFor,
  reactToMessageOutputSchema,
  reactToMessageToolResultSchema,
} from "./reaction";

const reactions = [
  ["thumbs_up", "👍"],
  ["thumbs_down", "👎"],
  ["heart", "❤️"],
  ["laugh", "😂"],
  ["exclamation", "‼️"],
  ["question", "❓"],
] as const;

describe("reaction contract", () => {
  it.each(reactions)("preserves %s and its display text", (type, text) => {
    expect(reactionTextFor(type)).toBe(text);
    expect(
      Schema.decodeUnknownSync(reactToMessageOutputSchema)({ type })
    ).toEqual({ operation: "add", type });
    expect(
      Schema.decodeUnknownSync(addReactionToMessageOutputSchema)({ type })
    ).toEqual({ operation: "add", type });
    for (const operation of ["add", "remove"]) {
      expect(
        Schema.decodeUnknownSync(reactToMessageOutputSchema)({
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
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(reactToMessageOutputSchema)(input)
      )
    ).toBe(false);
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(addReactionToMessageOutputSchema)(input)
      )
    ).toBe(false);
  });

  it("only allows add on the web contract", () => {
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(addReactionToMessageOutputSchema)({
          type: "heart",
          operation: "remove",
        })
      )
    ).toBe(false);
    expect(
      Schema.decodeUnknownSync(addReactionToMessageOutputSchema)({
        type: "heart",
        operation: "add",
        extra: true,
      })
    ).toEqual({ type: "heart", operation: "add" });
  });

  it("strips envelope and output extras and defaults the nested operation", () => {
    expect(
      Schema.decodeUnknownSync(reactToMessageToolResultSchema)({
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
        Result.isSuccess(
          Schema.decodeUnknownResult(reactToMessageToolResultSchema)(input)
        )
      ).toBe(false);
    }
  });
});
