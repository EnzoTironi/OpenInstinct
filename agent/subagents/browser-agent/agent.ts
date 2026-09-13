import { defineAgent, defineDynamic } from "eve";
import { Effect } from "effect";
import { browserInstallationModel } from "@agent/lib/installation-model";
import { resolveModeValue } from "@agent/lib/mode";
import { taskCompletionSchema } from "@agent/subagents/browser-agent/lib/completion";

export default defineAgent({
  description:
    "Execute one bounded browser assignment for the root coordinator in a personal or scheduled session, including secure vault autofill, transaction preparation, optional durable browser images, human-takeover handoff, cleanup, and a concise verified result. Unavailable in shared sessions. Every initial and resumed call must include the task-completion outputSchema required by the root instructions.",
  build: {
    externalDependencies: ["@onkernel/browser-loop"],
  },
  model: defineDynamic({
    events: {
      "step.started": (_event, context) => {
        if (
          !(context.session.auth.current ?? context.session.auth.initiator) ||
          !resolveModeValue(context, {
            interactive: true,
            "scheduled-worker": true,
          })
        ) {
          throw new Error(
            "Browser execution requires an authenticated personal or scheduled session."
          );
        }
        return Effect.runPromise(browserInstallationModel);
      },
    },
  }),
  reasoning: "low",
  outputSchema: taskCompletionSchema,
  compaction: {
    thresholdPercent: 0.7,
  },
});
