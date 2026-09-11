import { registerBackgroundReplyTarget } from "@agent/lib/reply-targets";
import { defineHook } from "eve/hooks";

export default defineHook({
  events: {
    "subagent.completed"(event, context) {
      const task = event.data.backgroundTask;

      if (!task) return;
      registerBackgroundReplyTarget(task.taskId, context.session.auth);
    },
  },
});
