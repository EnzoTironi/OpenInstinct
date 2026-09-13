import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export const workspaceGitLimits = {
  fileBytes: 262_144,
  bundleBytes: 25_165_824,
  files: 200,
} as const;
export const WorkspacePathSchema = Schema.String.check(
  Schema.isPattern(
    /^(?:(?:knowledge|skills|agent)\/[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}\.md|(?:plugins|ontology)\/workspace\.json)$/
  ),
  Schema.isPattern(/^(?!.*(?:\/\.|\.\.|\/\/)).*$/)
);
export const GitRevisionSchema = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{40}$/)
);

export class WorkspaceGitError extends Schema.TaggedError<WorkspaceGitError>()(
  "WorkspaceGitError",
  { reason: Schema.Literals(["invalid_file", "too_large", "unavailable"]) }
) {}

const git = Effect.fn("WorkspaceGit.command")(function* (
  directory: string,
  args: readonly string[],
  allowedExitCode = 0
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const process = yield* spawner.spawn(
    ChildProcess.make(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.allow=never",
        "-c",
        "commit.gpgSign=false",
        "--git-dir",
        directory,
        ...(args[0] === "init" ? [] : ["--work-tree", `${directory}/worktree`]),
        ...args,
      ],
      {
        env: {
          PATH: yield* Config.string("PATH"),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "Zoen",
          GIT_AUTHOR_EMAIL: "workspace@zoen.invalid",
          GIT_COMMITTER_NAME: "Zoen",
          GIT_COMMITTER_EMAIL: "workspace@zoen.invalid",
        },
        extendEnv: false,
        stdin: "ignore",
        stderr: "ignore",
        forceKillAfter: "1 second",
      }
    )
  );
  const output = yield* process.stdout.pipe(
    Stream.runFoldEffect(
      () => Buffer.alloc(0),
      (body, chunk) =>
        body.length + chunk.length > workspaceGitLimits.fileBytes * 2
          ? Effect.fail(new WorkspaceGitError({ reason: "too_large" }))
          : Effect.succeed(Buffer.concat([body, chunk]))
    )
  );
  const exitCode = yield* process.exitCode;
  if (exitCode !== 0 && exitCode !== allowedExitCode) {
    yield* Effect.logError("Workspace Git command failed", {
      command: args[0],
    });
    return yield* new WorkspaceGitError({ reason: "unavailable" });
  }
  return output.toString("utf8");
});

const openBundle = Effect.fn("WorkspaceGit.openBundle")(function* (
  bundle: Uint8Array | null
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "zoen-git-" });
  const repository = `${directory}/repository`;
  yield* git(repository, [
    "init",
    "--bare",
    "--initial-branch=main",
    repository,
  ]);
  yield* fs.makeDirectory(`${repository}/worktree`);
  if (bundle) {
    if (bundle.length > workspaceGitLimits.bundleBytes)
      return yield* new WorkspaceGitError({ reason: "too_large" });
    const path = `${directory}/source.bundle`;
    yield* fs.writeFile(path, bundle, { mode: 0o600 });
    yield* git(repository, ["bundle", "unbundle", path]);
  }
  return { fs, directory, repository };
});

export const readWorkspaceGit = Effect.fn("readWorkspaceGit")(
  function* (bundle: Uint8Array, revision: string, path?: string) {
    const sha = yield* Schema.decodeUnknownEffect(GitRevisionSchema)(revision);
    const { repository } = yield* openBundle(bundle);
    if (path !== undefined) {
      const files: string[] = [];
      const filename =
        yield* Schema.decodeUnknownEffect(WorkspacePathSchema)(path);
      return {
        content: yield* git(repository, ["show", `${sha}:${filename}`]),
        files,
      };
    }
    const files = (yield* git(repository, [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      sha,
    ]))
      .split("\0")
      .filter(Boolean);
    return { content: null, files };
  },
  Effect.scoped,
  Effect.timeout("10 seconds"),
  Effect.catchTag(
    "SchemaError",
    () => new WorkspaceGitError({ reason: "invalid_file" })
  ),
  Effect.catchTag(
    ["PlatformError", "ConfigError", "TimeoutError"],
    () => new WorkspaceGitError({ reason: "unavailable" })
  ),
  Effect.provide(NodeServices.layer)
);

export const readWorkspaceGitSelection = Effect.fn("readWorkspaceGitSelection")(
  function* (bundle: Uint8Array, revision: string, paths: readonly string[]) {
    const sha = yield* Schema.decodeUnknownEffect(GitRevisionSchema)(revision);
    const selected = yield* Schema.decodeUnknownEffect(
      Schema.Array(WorkspacePathSchema).check(Schema.isMaxLength(24))
    )(paths);
    const { repository } = yield* openBundle(bundle);
    return yield* Effect.forEach(
      selected,
      Effect.fn(function* (path) {
        return {
          path,
          content: yield* git(repository, ["show", `${sha}:${path}`]),
        };
      }),
      { concurrency: 4 }
    );
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.catchTag(
    ["SchemaError", "PlatformError", "ConfigError", "TimeoutError"],
    () => new WorkspaceGitError({ reason: "unavailable" })
  ),
  Effect.provide(NodeServices.layer)
);

export const searchWorkspaceGit = Effect.fn("searchWorkspaceGit")(
  function* (bundle: Uint8Array, revision: string, query: string) {
    const sha = yield* Schema.decodeUnknownEffect(GitRevisionSchema)(revision);
    const term = yield* Schema.decodeUnknownEffect(
      Schema.NonEmptyString.check(Schema.isMaxLength(200))
    )(query);
    const { repository } = yield* openBundle(bundle);
    const found = yield* git(
      repository,
      [
        "grep",
        "-I",
        "-n",
        "-i",
        "-F",
        "--max-count=3",
        "-e",
        term,
        sha,
        "--",
        "knowledge/",
      ],
      1
    );
    return found
      .split("\n")
      .filter(Boolean)
      .slice(0, 60)
      .map((line) => line.slice(sha.length + 1, sha.length + 801));
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.catchTag(
    ["SchemaError", "PlatformError", "ConfigError", "TimeoutError"],
    () => new WorkspaceGitError({ reason: "unavailable" })
  ),
  Effect.provide(NodeServices.layer)
);

export const publishWorkspaceGit = Effect.fn("publishWorkspaceGit")(
  function* (input: {
    readonly bundle: Uint8Array | null;
    readonly parent: string | null;
    readonly path: string;
    readonly content: string | null;
    readonly message: string;
  }) {
    const path = yield* Schema.decodeUnknownEffect(WorkspacePathSchema)(
      input.path
    );
    const parent =
      input.parent === null
        ? null
        : yield* Schema.decodeUnknownEffect(GitRevisionSchema)(input.parent);
    if (
      input.content !== null &&
      Buffer.byteLength(input.content) > workspaceGitLimits.fileBytes
    )
      return yield* new WorkspaceGitError({ reason: "too_large" });
    if (input.content?.includes("\0"))
      return yield* new WorkspaceGitError({ reason: "invalid_file" });
    const { fs, directory, repository } = yield* openBundle(input.bundle);
    if (parent) yield* git(repository, ["read-tree", parent]);
    if (input.content === null)
      yield* git(repository, ["update-index", "--force-remove", "--", path]);
    else {
      const file = `${directory}/content`;
      yield* fs.writeFileString(file, input.content, { mode: 0o600 });
      const blob = (yield* git(repository, [
        "hash-object",
        "-w",
        "--",
        file,
      ])).trim();
      yield* git(repository, [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob},${path}`,
      ]);
    }
    const tree = (yield* git(repository, ["write-tree"])).trim();
    const files = (yield* git(repository, [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      tree,
    ]))
      .split("\0")
      .filter(Boolean);
    if (files.length > workspaceGitLimits.files)
      return yield* new WorkspaceGitError({ reason: "too_large" });
    const revision = (yield* git(repository, [
      "commit-tree",
      tree,
      ...(parent ? ["-p", parent] : []),
      "-m",
      input.message,
    ])).trim();
    yield* git(repository, ["update-ref", "refs/heads/main", revision]);
    const destination = `${directory}/published.bundle`;
    yield* git(repository, ["bundle", "create", destination, "--all"]);
    const info = yield* fs.stat(destination);
    if (Number(info.size) > workspaceGitLimits.bundleBytes)
      return yield* new WorkspaceGitError({ reason: "too_large" });
    return {
      revision,
      bundle: Buffer.from(yield* fs.readFile(destination)),
      files,
    };
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.catchTag(
    "SchemaError",
    () => new WorkspaceGitError({ reason: "invalid_file" })
  ),
  Effect.catchTag(
    ["PlatformError", "ConfigError", "TimeoutError"],
    () => new WorkspaceGitError({ reason: "unavailable" })
  ),
  Effect.provide(NodeServices.layer)
);
