import { Effect, Schema } from "effect";
import { serverRuntime } from "../../../../server/runtime";
import { resolveWorkspaceActor } from "../../../../server/workspaces/session";
import { WorkspaceRepository } from "../../../../server/workspaces/repository";
import {
  convertWorkspaceDocument,
  workspaceImportBytes,
} from "../../../../server/workspaces/import";
import { isSameOrigin } from "@web/trpc/same-origin";
import { GitRevisionSchema } from "../../../../server/workspaces/git";

const importMetadata = Schema.Struct({
  operationId: Schema.String.check(Schema.isUUID()),
  expectedRevision: Schema.NullOr(GitRevisionSchema),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const length = Number(request.headers.get("content-length"));
  if (!length || length > workspaceImportBytes + 8192)
    return Response.json({ error: "too_large" }, { status: 413 });
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const actor = yield* resolveWorkspaceActor(request.headers);
      const form = yield* Effect.tryPromise(() => request.formData());
      const file = form.get("file");
      if (!(file instanceof File))
        return Response.json({ error: "invalid_document" }, { status: 400 });
      const metadata = yield* Schema.decodeUnknownEffect(importMetadata)({
        operationId: form.get("operationId"),
        expectedRevision: form.get("revision"),
      });
      const bytes = Buffer.from(
        yield* Effect.tryPromise(() => file.arrayBuffer())
      );
      const converted = yield* convertWorkspaceDocument(file.name, bytes);
      const slug =
        file.name
          .replace(/\.[^.]+$/, "")
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || "document";
      const path = `knowledge/${slug}.md`;
      const saved = yield* (yield* WorkspaceRepository).write(
        actor,
        {
          ...metadata,
          path,
          content: converted.content,
        },
        { kind: "import", filename: file.name, bytes }
      );
      return Response.json(
        { ...saved, path },
        { headers: { "cache-control": "private, no-store" } }
      );
    }).pipe(
      Effect.catchTag("WorkspaceAccessDenied", () =>
        Effect.succeed(Response.json({ error: "forbidden" }, { status: 403 }))
      ),
      Effect.catchTag("SchemaError", () =>
        Effect.succeed(
          Response.json({ error: "invalid_document" }, { status: 400 })
        )
      ),
      Effect.catchTag("WorkspaceImportError", (error) =>
        Effect.succeed(
          Response.json(
            { error: error.reason },
            { status: error.reason === "too_large" ? 413 : 422 }
          )
        )
      ),
      Effect.catchTag("WorkspaceRepositoryError", (error) =>
        Effect.succeed(
          Response.json(
            { error: error.reason },
            { status: error.reason === "conflict" ? 409 : 400 }
          )
        )
      )
    ),
    { signal: request.signal }
  );
}
