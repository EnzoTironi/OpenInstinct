import { Effect } from "effect";
import type { SessionAuthContext } from "eve/context";

import { BrowserWorkerAccess } from "../../../../server/browser-worker";
import { serverRuntime } from "../../../../server/runtime";

const denialMessage = {
  lease_inactive: "The scheduled run lease is no longer active.",
  paused: "The scheduled job is no longer active.",
  revoked: "The caller's channel authority has been revoked.",
  unauthenticated: "The caller no longer has live authority.",
  unavailable: "Live authority could not be verified.",
} as const;

export async function assertLiveWorkerAuthority(principal: SessionAuthContext) {
  await serverRuntime.runPromise(
    Effect.gen(function* () {
      const access = yield* BrowserWorkerAccess;

      return yield* access.authorize(principal);
    }).pipe(
      Effect.catchTag("BrowserWorkerAccessError", (error) =>
        Effect.fail(new Error(denialMessage[error.reason]))
      )
    )
  );
}
