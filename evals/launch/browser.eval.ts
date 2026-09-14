import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";
import { requireWorkerSessionId } from "@evals/browser/session";
import { readTaskCompletion } from "@evals/browser/worker-events";

export default defineEval({
  description:
    "Delegate a real browser task through Executor and close its browser",
  tags: ["launch", "browser", "live-model", "live-provider", "synthetic-data"],
  timeoutMs: 240_000,
  async test(t) {
    const started = await t.send(
      "Use the browser to visually inspect https://example.com and report its exact primary heading. This requires a browser, not web_fetch. Close the browser after reading it. Do not log in, submit forms or send external messages."
    );
    const childId = await requireWorkerSessionId(t, started);
    const child = await t.target.attachSession(childId);
    child.succeeded();
    child
      .noFailedActions()
      .soft()
      .label("browser native actions without failure");
    child.calledTool("execute", {
      status: "completed",
      input: { call: { path: "manage_browsers", input: { action: "create" } } },
      count: 1,
    });
    child.calledTool("execute", {
      status: "completed",
      input: { call: { path: "manage_browsers", input: { action: "delete" } } },
      count: 1,
    });
    child
      .calledTool("execute", {
        status: "completed",
        input: { call: { path: "playwright_execute" } },
        count: (count) => count >= 1,
      })
      .label("real browser page inspection");
    const completion = readTaskCompletion(child.events);
    t.check(completion?.status, equals("success"));
    t.check(completion?.message, includes("Example Domain"));
    child.event("result.completed", { count: 1 });
  },
});
