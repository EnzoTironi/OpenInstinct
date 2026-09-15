import { describe, expect, it } from "vitest";
import { reviewSentinel } from "./sentinel";

const privateTurn = {
  actorUserId: "better-auth:alice",
  destinationUserId: "better-auth:alice",
  hasParent: false,
  promptClaimsGrant: false,
  reviewer: "ok" as const,
  streamingUnreviewed: false,
  workerSelfAuthorizes: false,
};

describe("Sentinel host intercept", () => {
  it("does allow private same-audience output and deny crossing without ask", () => {
    expect(reviewSentinel(privateTurn)).toEqual({ kind: "allow" });
    expect(
      reviewSentinel({
        ...privateTurn,
        destinationUserId: "better-auth:bob",
      })
    ).toEqual({
      kind: "ask",
      reason: "private_approval_required",
    });
  });

  it("does fail closed on timeout, unreviewed stream, injection and self-approval", () => {
    expect(reviewSentinel({ ...privateTurn, reviewer: "timeout" })).toEqual({
      kind: "deny",
      reason: "reviewer_failed",
    });
    expect(reviewSentinel({ ...privateTurn, reviewer: "error" })).toEqual({
      kind: "deny",
      reason: "reviewer_failed",
    });
    expect(
      reviewSentinel({ ...privateTurn, streamingUnreviewed: true })
    ).toEqual({ kind: "deny", reason: "unreviewed_stream" });
    expect(reviewSentinel({ ...privateTurn, promptClaimsGrant: true })).toEqual(
      { kind: "deny", reason: "grant_injection" }
    );
    expect(
      reviewSentinel({ ...privateTurn, workerSelfAuthorizes: true })
    ).toEqual({ kind: "deny", reason: "self_authorization" });
    expect(reviewSentinel({ ...privateTurn, hasParent: true })).toEqual({
      kind: "deny",
      reason: "child_cannot_send",
    });
    expect(reviewSentinel({ ...privateTurn, childRole: "researcher" })).toEqual(
      { kind: "deny", reason: "read_only_contract" }
    );
    expect(reviewSentinel({ ...privateTurn, childRole: "advisor" })).toEqual({
      kind: "deny",
      reason: "read_only_contract",
    });
    expect(reviewSentinel({ ...privateTurn, childRole: "builder" })).toEqual({
      kind: "allow",
    });
  });
});
