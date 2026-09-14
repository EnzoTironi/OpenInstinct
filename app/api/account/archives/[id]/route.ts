import { Effect, Schema } from "effect";
import { downloadAccountArchive } from "../../../../../server/accounts/archives";
import { serverRuntime } from "../../../../../server/runtime";
import { Mem0 } from "../../../../../server/memory/mem0";

export async function GET(
  request: Request,
  context: RouteContext<"/api/account/archives/[id]">
) {
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const section = yield* Schema.decodeUnknownEffect(
        Schema.Literals(["memory", "files", "attachment", "source"])
      )(query.get("section"));
      return yield* downloadAccountArchive(
        request.headers,
        id,
        section,
        query.get("attachment") ?? undefined
      );
    }).pipe(
      Effect.provide(Mem0.layer),
      Effect.catchTag("AccountControlError", () =>
        Effect.succeed(
          new Response("Sign in to continue", {
            status: 401,
            headers: { "cache-control": "no-store" },
          })
        )
      ),
      Effect.catchTag(["AccountArchiveMissing", "SchemaError"], () =>
        Effect.succeed(
          new Response("Not found", {
            status: 404,
            headers: { "cache-control": "no-store" },
          })
        )
      ),
      Effect.catchTag(["AuthUnavailable", "Mem0Error", "SqlError"], () =>
        Effect.succeed(
          new Response("Archive unavailable", {
            status: 503,
            headers: { "cache-control": "no-store" },
          })
        )
      )
    ),
    { signal: request.signal }
  );
}
