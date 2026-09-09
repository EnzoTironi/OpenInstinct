import { ConfigProvider, Effect } from "effect";
import { postInternalRequestEffect } from "../internal-request";
import { InternalCallbackRejected } from "../../../server/internal/callback-auth";

export function postScheduledReport(runId: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* postInternalRequestEffect(
        "/internal/scheduled-run/report",
        { runId }
      );
      if (!response.ok)
        return yield* new InternalCallbackRejected({ status: 503 });
      return undefined;
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv()
      )
    )
  );
}
