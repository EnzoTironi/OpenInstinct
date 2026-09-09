import { Effect } from "effect";
import {
  accountPrivacyErrorResponse,
  deleteAccountOnlineDataResponse,
} from "../../../../server/accounts/privacy";
import { serverRuntime } from "../../../../server/runtime";

export function POST(request: Request) {
  return serverRuntime.runPromise(
    deleteAccountOnlineDataResponse(request.headers).pipe(
      Effect.catchTag("AccountPrivacyError", (error) =>
        Effect.succeed(accountPrivacyErrorResponse(error))
      )
    ),
    { signal: request.signal }
  );
}
