import { Effect } from "effect";
import { exportPersonalMemory } from "../../../../../server/personal-memory/export";
import { serverRuntime } from "../../../../../server/runtime";

export function GET(request: Request) {
  return serverRuntime.runPromise(
    exportPersonalMemory(request.headers).pipe(
      Effect.catchTag("PersonalMemoryError", (error) =>
        Effect.succeed(
          new Response(
            error.reason === "unauthenticated"
              ? "Sign in to export your personal memory."
              : "Personal memory is unavailable. Try again.",
            {
              status: error.reason === "unauthenticated" ? 401 : 503,
              headers: { "cache-control": "private, no-store" },
            }
          )
        )
      )
    ),
    { signal: request.signal }
  );
}
