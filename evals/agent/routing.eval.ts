import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";
import { executorInvocations } from "./executor";
import { requireWorkerSessionId } from "@evals/browser/session";
import { readTaskCompletion } from "@evals/browser/worker-events";
import {
  agentEvalTags,
  assertPlainTextDelivery,
  requireDeliveredText,
} from "@evals/agent/shared";

export default [
  defineEval({
    description: "Reads a known public URL with web_fetch",
    tags: [...agentEvalTags, "routing"],
    async test(t) {
      const turn = await t.send(
        "Read https://example.com and tell me the page heading. Use the page itself rather than prior knowledge."
      );
      turn.expectOk();
      turn.succeeded();
      t.check(executorInvocations(turn, "web_fetch"), equals(1));
      turn.notCalledTool("web_search");
      turn.notEvent("subagent.called", { data: { name: "browser-agent" } });
      const text = await requireDeliveredText(t, turn);
      t.check(text, includes(/example domain/iu));
      assertPlainTextDelivery(t, text);
    },
  }),
  defineEval({
    description:
      "Uses available public research capabilities to find a primary source",
    tags: [...agentEvalTags, "routing"],
    async test(t) {
      const turn = await t.send(
        "Find the official website for Brooklyn Botanic Garden. Give me its name and URL. This is public research; do not interact with the site."
      );
      turn.expectOk();
      turn.succeeded();
      t.check(executorInvocations(turn, "gmail-send"), equals(0));
      const childId = await requireWorkerSessionId(t, turn);
      const child = await t.target.attachSession(childId);
      child.succeeded();
      const completion = readTaskCompletion(child.events);
      t.check(completion?.status, equals("success"));
      t.check(
        completion?.message,
        includes(/https?:\/\/(?:www\.)?bbg\.org\b/iu)
      );
    },
  }),
  defineEval({
    description: "Drafts an email without sending or delegating",
    tags: [...agentEvalTags, "routing", "smoke"],
    async test(t) {
      const turn = await t.send(
        "Draft a two-sentence email to a neighbor asking whether they can water my plants this weekend. Do not send it."
      );
      turn.expectOk();
      turn.succeeded();
      t.check(executorInvocations(turn, "gmail-send"), equals(0));
      turn.notEvent("subagent.called", { data: { name: "browser-agent" } });
      const text = await requireDeliveredText(t, turn);
      t.judge.autoevals
        .closedQA(
          "The response provides a usable two-sentence email draft asking a neighbor to water plants this weekend and does not claim it was sent.",
          { on: text }
        )
        .label("draft-only boundary")
        .atLeast(0.8);
      assertPlainTextDelivery(t, text);
    },
  }),
];
