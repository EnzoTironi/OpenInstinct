import { Effect } from "effect";
import { defineSchedule } from "eve/schedules";
import a2a from "../channels/a2a";
import { listPendingProtocolTasks } from "../../server/a2a/delivery";
import { pendingProtocolCancellations } from "../../server/a2a/cancellation";
import { retireMatrixRooms } from "../../server/matrix/retirement";
import { serverRuntime } from "../../server/runtime";
import {
  pendingMatrixProtocolAnswers,
  publishMatrixProtocolAnswer,
} from "../../server/matrix/network-delivery";

export default defineSchedule({
  cron: "* * * * *",
  run({ to, appAuth, waitUntil }) {
    waitUntil(
      serverRuntime.runPromise(
        Effect.gen(function* () {
          yield* Effect.forEach(
            yield* pendingProtocolCancellations(),
            ({ session_id }) =>
              Effect.tryPromise({
                try: () =>
                  to(a2a, { cancelSessionId: session_id }).send(
                    "Retire revoked task",
                    { auth: appAuth }
                  ),
                catch: () => new Error("A2A cancellation remains pending"),
              }).pipe(
                Effect.catch(() =>
                  Effect.logWarning("A2A cancellation will be retried")
                )
              ),
            { concurrency: 2 }
          );
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
          yield* Effect.forEach(
            yield* pendingMatrixProtocolAnswers(),
            ({ id }) =>
              publishMatrixProtocolAnswer(id).pipe(
                Effect.catch(() =>
                  Effect.logWarning("Matrix result delivery remains pending", {
                    taskId: id,
                  })
                )
              ),
            { concurrency: 2 }
          );
          yield* retireMatrixRooms().pipe(
            Effect.catchTag("MatrixError", () => Effect.void)
          );
        })
      )
    );
  },
});
