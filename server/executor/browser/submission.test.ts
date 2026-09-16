import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { EnqueueInputSchema } from "../../messaging/model";
import { browserSubmissionEffect } from "./submission";

it("does bind a browser submit to an outbox operation before any provider call", async () => {
  const submission = browserSubmissionEffect({
    operationId: "op:form-1",
    origin: "https://example.test",
    target: "https://example.test/apply",
  });
  expect(submission.effectKind).toBe("browser_submit");
  await expect(
    Effect.runPromise(
      Schema.decodeUnknownEffect(EnqueueInputSchema)({
        effectKind: submission.effectKind,
        identityId: "11111111-1111-4111-8111-111111111111",
        deliveryKey: submission.operationId,
        operationId: submission.operationId,
        payload: { text: submission.target },
      })
    )
  ).resolves.toMatchObject({
    effectKind: "browser_submit",
    operationId: "op:form-1",
  });
  expect(() =>
    browserSubmissionEffect({
      operationId: "op:form-1",
      origin: "https://example.test",
      target: "https://example.test/apply",
      extra: true,
    })
  ).toThrow(/excess|Unexpected|extra/i);
});
