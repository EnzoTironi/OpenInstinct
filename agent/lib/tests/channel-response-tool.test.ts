import { describe, expect, test } from "vitest";
import { Schema } from "effect";
import responseTool, { inputSchema } from "../../tools/respond-to-approval";

describe("natural approval tool input boundary", () => {
  const decode = Schema.toStandardSchemaV1(inputSchema, {
    parseOptions: { onExcessProperty: "error" },
  })["~standard"].validate;

  test.each(["approve", "cancel"])(
    "accepts the %s decision",
    async (decision) => {
      expect(await decode({ requestId: "pending-request", decision })).toEqual({
        value: { requestId: "pending-request", decision },
      });
    }
  );

  test.each([
    { identityId: "actor-chosen-by-model" },
    { sessionId: "another-session" },
    { sourceMessageId: "old-message" },
    { turnId: "old-turn" },
    { auth: { principalId: "other-user" } },
    { revision: "model-selected-version" },
    { recipient: "another-person" },
    { text: "fabricated user consent" },
  ])("rejects model-supplied authority or source fields %j", async (extra) => {
    expect(
      await decode({
        requestId: "pending-request",
        decision: "approve",
        ...extra,
      })
    ).toHaveProperty("issues");
  });

  test.each([
    { requestId: "pending-request", decision: "yes" },
    { requestId: "pending-request", decision: "correct" },
    { requestId: "", decision: "approve" },
    { requestId: "pending-request" },
    { decision: "approve" },
  ])("rejects an incomplete or unsupported decision %j", async (value) => {
    expect(await decode(value)).toHaveProperty("issues");
  });
});

describe("approval responder availability", () => {
  const resolve = responseTool.events["step.started"];
  if (!resolve) throw new Error("Approval tool resolver required");
  test.each([
    ["authjs", "web", "fresh", false],
    ["authjs", "telegram", "fresh", false],
    ["verified-channel", "telegram", "fresh", true],
    ["verified-channel", "kapso", "fresh", true],
    ["verified-channel", "telegram", "", false],
    ["matrix", "matrix", "fresh", false],
  ] as const)(
    "%s/%s requires a fresh native user message",
    async (authenticator, conversationChannel, sourceMessageId, visible) => {
      const tool = await resolve(
        {},
        {
          channel: { kind: conversationChannel, metadata: {} },
          messages: [],
          session: {
            id: "synthetic-session",
            auth: {
              initiator: null,
              current: {
                authenticator,
                principalId: "synthetic-user",
                principalType: "user",
                attributes: { conversationChannel, sourceMessageId },
              },
            },
          },
        }
      );
      expect(tool !== null).toBe(visible);
    }
  );
});
