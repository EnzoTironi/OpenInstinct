import { Effect } from "effect";
import {
  AccountDeletionError,
  requestAccountDeletionFromHeaders,
} from "../../../../server/accounts/deletion";
import { serverRuntime } from "../../../../server/runtime";

export function POST(request: Request) {
  return serverRuntime.runPromise(
    requestAccountDeletionFromHeaders(request.headers).pipe(
      Effect.map(
        (body) =>
          new Response(JSON.stringify(body, null, 2), {
            status: 200,
            headers: {
              "cache-control": "private, no-store",
              "content-type": "application/json; charset=utf-8",
              "x-content-type-options": "nosniff",
            },
          })
      ),
      Effect.catchTag("AccountDeletionError", (error) =>
        Effect.succeed(accountDeletionErrorResponse(error))
      )
    ),
    { signal: request.signal }
  );
}

function accountDeletionErrorResponse(error: AccountDeletionError) {
  const status =
    error.reason === "unauthenticated"
      ? 401
      : error.reason === "blocked_sole_owner"
        ? 409
        : 503;
  const limits =
    error.reason === "unauthenticated"
      ? "Sign in to delete this account."
      : error.reason === "blocked_sole_owner"
        ? "Transfer company admin or close the organization before deleting this account. Active deletion is distinct from later backup expiry."
        : "Account deletion is unavailable. Try again.";
  return new Response(
    JSON.stringify({
      backupExpiresAt: null,
      limits,
      pending: [],
      reason: error.reason,
      retainedCompany: [],
      status: "blocked",
    }),
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    }
  );
}
