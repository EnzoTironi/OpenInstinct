import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { ConfigProvider, Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { InternalCallbackRejected } from "../../../server/internal/callback-auth";
import { postInternalRequestEffect } from "../internal-request";

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
      Effect.provide(ResolvedInstallationSecrets.layer),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv()
      )
    )
  );
}
