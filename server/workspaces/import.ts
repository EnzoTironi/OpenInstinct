import { createHash } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { workspaceGitLimits } from "./git";

export const workspaceImportBytes = 10 * 1024 * 1024;
const supportedExtensions = new Set([
  "md",
  "txt",
  "csv",
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "epub",
  "ppt",
  "pptx",
  "xlsx",
  "xls",
  "ods",
  "odp",
]);

class WorkspaceImportError extends Schema.TaggedError<WorkspaceImportError>()(
  "WorkspaceImportError",
  {
    reason: Schema.Literals([
      "too_large",
      "unsupported",
      "needs_ocr",
      "invalid_document",
    ]),
  }
) {}

export const convertWorkspaceDocument = Effect.fn("convertWorkspaceDocument")(
  function* (filename: string, bytes: Uint8Array) {
    if (bytes.length === 0 || bytes.length > workspaceImportBytes)
      return yield* new WorkspaceImportError({ reason: "too_large" });
    const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
    if (!supportedExtensions.has(extension))
      return yield* new WorkspaceImportError({ reason: "unsupported" });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (extension === "md" || extension === "txt") {
      if (bytes.length > workspaceGitLimits.fileBytes)
        return yield* new WorkspaceImportError({ reason: "too_large" });
      const content = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        catch: () => new WorkspaceImportError({ reason: "invalid_document" }),
      });
      if (content.includes("\0"))
        return yield* new WorkspaceImportError({ reason: "invalid_document" });
      return { content, sha256 };
    }
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({
      prefix: "zoen-import-",
    });
    const file = `${directory}/document.${extension}`;
    yield* fs.writeFile(file, bytes, { mode: 0o600 });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(
        process.execPath,
        [
          "--max-old-space-size=128",
          "--input-type=commonjs",
          "--eval",
          // Resolve inside Node: Turbopack turns require.resolve into a module ID.
          "process.argv.splice(1, 0, 'anydoc'); require('@firecrawl/anydoc/cli.js');",
          file,
          "--ocr",
          "reject",
        ],
        {
          stdin: "ignore",
          stderr: "ignore",
          env: { PATH: yield* Config.string("PATH") },
          extendEnv: false,
          forceKillAfter: "1 second",
        }
      )
    );
    const content = yield* child.stdout.pipe(
      Stream.runFoldEffect(
        () => Buffer.alloc(0),
        (body, chunk) =>
          body.length + chunk.length > workspaceGitLimits.fileBytes
            ? Effect.fail(new WorkspaceImportError({ reason: "too_large" }))
            : Effect.succeed(Buffer.concat([body, chunk]))
      )
    );
    const exit = yield* child.exitCode;
    if (exit === 3)
      return yield* new WorkspaceImportError({ reason: "needs_ocr" });
    if (exit !== 0 || content.length === 0)
      return yield* new WorkspaceImportError({ reason: "invalid_document" });
    return { content: content.toString("utf8"), sha256 };
  },
  Effect.scoped,
  Effect.timeout("20 seconds"),
  Effect.catchTag(
    ["PlatformError", "ConfigError", "TimeoutError"],
    () => new WorkspaceImportError({ reason: "invalid_document" })
  ),
  Effect.provide(NodeServices.layer)
);
