import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import { serverRuntime } from "../../../server/runtime";

/** Readiness includes the database; Eve's own endpoint remains the runtime probe. */
export async function GET(request: Request) {
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`SELECT 1`;
      return Response.json(
        { status: "ready" },
        { headers: { "cache-control": "no-store" } }
      );
    }).pipe(
      Effect.timeout("2 seconds"),
      Effect.catchTag(["SqlError", "TimeoutError"], () =>
        Effect.succeed(
          Response.json(
            { status: "unavailable" },
            { status: 503, headers: { "cache-control": "no-store" } }
          )
        )
      )
    ),
    { signal: request.signal }
  );
}
