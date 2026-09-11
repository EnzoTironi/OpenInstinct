import {
  agentEvalTags,
  assertPlainTextDelivery,
  requireDeliveredText,
} from "@evals/agent/shared";
import { defineEval, type EveEvalContext } from "eve/evals";
import { includes } from "eve/evals/expect";

const preferenceCanary = "quiet-car preference on train trips";

function throwCombinedErrors(
  evaluationError: Error | undefined,
  cleanupError: Error | undefined,
  bothMessage: string
) {
  if (evaluationError && cleanupError) {
    throw new AggregateError([evaluationError, cleanupError], bothMessage);
  }

  if (evaluationError) throw evaluationError;

  if (cleanupError) throw cleanupError;
}

async function runMemoryRecallCase(t: EveEvalContext) {
  const first = await t.send(
    `Remember this exact preference for future trips: ${preferenceCanary}.`
  );

  first.expectOk();
  first.succeeded();
  first.calledTool("profile__save_memory", { count: 1 });
  await requireDeliveredText(t, first);

  const laterSession = t.newSession();

  const later = await laterSession.send(
    "What seating preference have I told you to use for train trips?"
  );

  later.expectOk();
  later.succeeded();
  const text = await requireDeliveredText(t, later);
  t.check(text, includes(/quiet.?car/iu));
  assertPlainTextDelivery(t, text);
}

async function cleanupMemoryCanary(t: EveEvalContext) {
  const cleanupSession = t.newSession();

  const cleanup = await cleanupSession.send(
    `Use profile__remove_memory to forget this exact preference: ${preferenceCanary}.`
  );

  cleanup.expectOk();
  cleanup.succeeded();
  cleanup.calledTool("profile__remove_memory", { count: 1 });
  await requireDeliveredText(t, cleanup);
}

export default [
  defineEval({
    description: "Recalls a stable preference in a separate session",
    tags: [...agentEvalTags, "memory"],
    async test(t) {
      let evaluationError: Error | undefined;

      try {
        await runMemoryRecallCase(t);
      } catch (error) {
        evaluationError =
          error instanceof Error
            ? error
            : new Error("Memory evaluation failed with a non-Error value.", {
                cause: error,
              });
      }

      let cleanupError: Error | undefined;

      try {
        await cleanupMemoryCanary(t);
      } catch (error) {
        cleanupError =
          error instanceof Error
            ? error
            : new Error("Memory cleanup failed with a non-Error value.", {
                cause: error,
              });
      }

      throwCombinedErrors(
        evaluationError,
        cleanupError,
        "Memory evaluation and canary cleanup both failed."
      );
    },
  }),
  defineEval({
    description: "Does not save an explicitly one-off preference",
    tags: [...agentEvalTags, "memory", "smoke"],
    async test(t) {
      const turn = await t.send(
        "For today only, I want sparkling water with lunch. Do not save that as a preference."
      );

      turn.expectOk();
      turn.succeeded();
      turn.notCalledTool("profile__save_memory");
      turn.notCalledTool("personal_info__update");
      const text = await requireDeliveredText(t, turn);
      assertPlainTextDelivery(t, text);
    },
  }),
];
