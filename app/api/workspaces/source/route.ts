import { Effect } from "effect";
import { serverRuntime } from "../../../../server/runtime";
import { resolveWorkspaceActor } from "../../../../server/workspaces/session";
import { WorkspaceRepository } from "../../../../server/workspaces/repository";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const workspace = url.searchParams.get("space");
  if (workspace) headers.set("x-zoen-workspace", workspace);
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const actor = yield* resolveWorkspaceActor(headers);
      const source = yield* (yield* WorkspaceRepository).source(
        actor,
        url.searchParams.get("revision") ?? ""
      );
      return new Response(Buffer.from(source.bytes), {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
        },
      });
    }).pipe(
      Effect.catchTag("WorkspaceAccessDenied", () =>
        Effect.succeed(new Response(null, { status: 403 }))
      ),
      Effect.catchTag("WorkspaceRepositoryError", () =>
        Effect.succeed(new Response(null, { status: 404 }))
      )
    ),
    { signal: request.signal }
  );
}
