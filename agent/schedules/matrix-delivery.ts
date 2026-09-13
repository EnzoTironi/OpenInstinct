import { Effect } from "effect";
import { defineSchedule } from "eve/schedules";
import matrix from "../channels/matrix";
import {
  pendingMatrixEvents,
  publishMatrixAnswer,
} from "../../server/matrix/delivery";
import { serverRuntime } from "../../server/runtime";
import { reconcileMatrixRooms } from "../../server/matrix/rooms";

export default defineSchedule({
  cron: "* * * * *",
  run({ to, appAuth, waitUntil }) {
    waitUntil(
      serverRuntime.runPromise(
        Effect.gen(function* () {
          yield* reconcileMatrixRooms();
          const events = yield* pendingMatrixEvents();
          yield* Effect.forEach(
            events,
            (event) =>
              Effect.gen(function* () {
                if (event.state === "answer_ready")
                  yield* publishMatrixAnswer(event.eventId);
                else
                  yield* Effect.tryPromise(() =>
                    to(matrix, { eventId: event.eventId }).send(
                      "Resume accepted Matrix event",
                      { auth: appAuth }
                    )
                  );
              }).pipe(
                Effect.catch(() =>
                  Effect.logWarning("Matrix delivery will be retried", {
                    eventId: event.eventId,
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
