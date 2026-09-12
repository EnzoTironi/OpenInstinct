import { Effect } from "effect";
import { expect, it } from "vitest";
import { confirmEmail, viewedProposalMatches } from "./email-flow";
import { OperonMcpClient, OperonMcpError } from "./mcp-client";

const digest = "a".repeat(64);
const pending = {
  sessionId: "session-1",
  workspaceId: "workspace-1",
  proposalId: "proposal-1",
  digest,
  card: "3 conversas em quarentena, 3 pessoas, 1 empresas, 0 nomes em conflito.",
};

it("does reject confirm without the matching digest", async () => {
  const error = await Effect.runPromise(
    confirmEmail(pending, "b".repeat(64)).pipe(
      Effect.flip,
      Effect.provideService(
        OperonMcpClient,
        OperonMcpClient.of({
          call: () =>
            Effect.fail(
              new OperonMcpError({
                error: "should-not-call",
                message: "MCP must not run when the digest does not match",
              })
            ),
        })
      )
    )
  );
  expect(error).toMatchObject({ reason: "stale_digest" });
});

it("does reach MCP when the viewed digest matches", async () => {
  const error = await Effect.runPromise(
    confirmEmail(pending, digest).pipe(
      Effect.flip,
      Effect.provideService(
        OperonMcpClient,
        OperonMcpClient.of({
          call: () =>
            Effect.fail(
              new OperonMcpError({
                error: "OperonUnavailable",
                message: "unit test",
              })
            ),
        })
      )
    )
  );
  expect(error).toMatchObject({
    _tag: "OperonMcpError",
    error: "OperonUnavailable",
  });
});

it("does reject a viewed digest that does not match the pending proposal", () => {
  expect(
    viewedProposalMatches(pending, {
      digest: "b".repeat(64),
      card: pending.card,
    })
  ).toBe(false);
});

it("does reject a viewed card that does not match the pending proposal", () => {
  expect(
    viewedProposalMatches(pending, {
      digest,
      card: "4 conversas em quarentena, 4 pessoas, 1 empresas, 0 nomes em conflito.",
    })
  ).toBe(false);
});

it("does bind confirm to the pending digest and card without Eve approval prose", () => {
  expect(
    viewedProposalMatches(pending, {
      digest,
      card: pending.card,
    })
  ).toBe(true);
  expect(viewedProposalMatches(null, { digest, card: pending.card })).toBe(
    false
  );
});
