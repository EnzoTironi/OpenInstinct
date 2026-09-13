import { Effect } from "effect";
import { serverRuntime } from "../../../../server/runtime";
import { resolveWorkspaceActor } from "../../../../server/workspaces/session";
import { WorkspaceRepository } from "../../../../server/workspaces/repository";

export async function GET(request: Request) {
  const headers = new Headers(request.headers);
  const space = new URL(request.url).searchParams.get("space");
  if (space) headers.set("x-zoen-workspace", space);
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const actor = yield* resolveWorkspaceActor(headers);
      const stored = yield* (yield* WorkspaceRepository).export(actor);
      if (!stored) return new Response(null, { status: 404 });
      return new Response(Buffer.from(stored.bundle), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="zoen-workspace.bundle"',
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }).pipe(
      Effect.catchTag("WorkspaceAccessDenied", () =>
        Effect.succeed(new Response(null, { status: 403 }))
      )
    ),
    { signal: request.signal }
  );
}
