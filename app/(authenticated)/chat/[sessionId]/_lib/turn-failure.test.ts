import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { getLatestTurnFailure } from "./turn-failure";

describe("turn failures", () => {
  it("keeps a parked failed child visibly failed", () => {
    const events = [
      {
        data: {
          code: "CHILD_FAILED",
          message: "Child failed.",
          sequence: 1,
          turnId: "child-turn",
        },
        meta: { at: "2026-08-27T20:00:00.000Z", id: "failed" },
        type: "turn.failed",
      },
      {
        data: { continuationToken: "", wait: "next-user-message" },
        meta: { at: "2026-08-27T20:00:01.000Z", id: "waiting" },
        type: "session.waiting",
      },
    ] satisfies MessageStreamEvent[];

    expect(getLatestTurnFailure(events)).toBe("Child failed.");
  });

  it("does surface a model outage without fabricating an answer", () => {
    const events = [
      {
        data: {
          code: "MODEL_CALL_FAILED",
          message: "upstream timeout",
          sequence: 1,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-15T17:00:00.000Z", id: "failed" },
        type: "turn.failed",
      },
    ] satisfies MessageStreamEvent[];

    expect(getLatestTurnFailure(events)).toBe(
      "The model is temporarily unavailable. Please try again."
    );
  });

  it("surfaces a credit failure distinctly from an outage and hides the provider payload", () => {
    const events = [
      {
        data: {
          code: "MODEL_CALL_FAILED",
          message: "OpenRouter 402 insufficient credits for the selected model",
          sequence: 1,
          turnId: "turn-2",
        },
        meta: { at: "2026-09-15T18:00:00.000Z", id: "failed" },
        type: "turn.failed",
      },
    ] satisfies MessageStreamEvent[];

    expect(getLatestTurnFailure(events)).toBe(
      "The model provider has no remaining credits. Check billing and try again."
    );
    expect(getLatestTurnFailure(events)).not.toContain("OpenRouter");
    expect(getLatestTurnFailure(events)).not.toContain("402");
  });

  it("surfaces a rejected model connection without the provider payload", () => {
    const events = [
      {
        data: {
          code: "MODEL_CALL_FAILED",
          message: "401 invalid api key from gateway",
          sequence: 1,
          turnId: "turn-3",
        },
        meta: { at: "2026-09-15T18:05:00.000Z", id: "failed" },
        type: "turn.failed",
      },
    ] satisfies MessageStreamEvent[];

    expect(getLatestTurnFailure(events)).toBe(
      "The model provider rejected this request. Check the configured model connection."
    );
    expect(getLatestTurnFailure(events)).not.toContain("401");
    expect(getLatestTurnFailure(events)).not.toContain("api key");
  });
});
