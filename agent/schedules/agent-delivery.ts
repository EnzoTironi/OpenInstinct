import { Effect } from "effect";
import { defineSchedule } from "eve/schedules";
import a2a from "../channels/a2a";
import { listPendingProtocolTasks } from "../../server/a2a/delivery";
import { serverRuntime } from "../../server/runtime";

export default defineSchedule({
  cron: "* * * * *",
  run({ to, appAuth, waitUntil }) {
    waitUntil(
      serverRuntime.runPromise(
        Effect.gen(function* () {
          const tasks = yield* listPendingProtocolTasks();
          yield* Effect.forEach(
            tasks,
            ({ id }) =>
              Effect.tryPromise({
                try: () =>
                  to(a2a, { taskId: id }).send("Resume accepted task", {
                    auth: appAuth,
                  }),
                catch: () => new Error("A2A delivery remains pending"),
              }).pipe(
                Effect.catch(() =>
                  Effect.logWarning("A2A delivery will be retried", {
                    taskId: id,
                  })
                )
              ),
            { concurrency: 2 }
          );
        })
      )
    );
  },
});
