import { Effect } from "effect";
import {
  accountPrivacyErrorResponse,
  exportAccountPrivacyResponse,
} from "../../../../server/accounts/privacy";
import { serverRuntime } from "../../../../server/runtime";

export function GET(request: Request) {
  return serverRuntime.runPromise(
    exportAccountPrivacyResponse(request.headers).pipe(
      Effect.catchTag("AccountPrivacyError", (error) =>
        Effect.succeed(accountPrivacyErrorResponse(error))
      )
    ),
    { signal: request.signal }
  );
}
