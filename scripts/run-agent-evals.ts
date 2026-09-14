import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import {
  Config,
  Effect,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { randomUUID } from "node:crypto";
import { Client } from "eve/client";

class EvalFailed extends Schema.TaggedError<EvalFailed>()("EvalFailed", {
  message: Schema.String,
}) {}

const loopback = (hostname: string) =>
  hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

const safeEnvironment = Effect.gen(function* () {
  const environment: Record<string, string> = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) {
    const value = yield* Config.option(Config.string(name));
    if (Option.isSome(value)) environment[name] = value.value;
  }
  for (const name of [
    "AI_GATEWAY_API_KEY",
    "OPENROUTER_API_KEY",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "SECRET_ENCRYPTION_KEY",
    "DATABASE_URL",
  ]) {
    const value = yield* Config.option(Config.redacted(name));
    if (Option.isSome(value)) environment[name] = Redacted.value(value.value);
  }
  return environment;
});

const summarySchema = Schema.Struct({
  counts: Schema.Struct({
    passed: Schema.Number,
    failed: Schema.Number,
    skipped: Schema.Number,
    scored: Schema.Number,
  }),
});

const command = Command.make(
  "eval-agent",
  {
    url: Flag.string("url").pipe(Flag.optional),
    suite: Flag.string("suite").pipe(Flag.withDefault("launch")),
    tag: Flag.string("tag").pipe(Flag.optional),
    list: Flag.boolean("list").pipe(Flag.withDefault(false)),
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
    repeat: Flag.integer("repeat").pipe(
      Flag.withSchema(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))
      ),
      Flag.withDefault(1)
    ),
    timeout: Flag.integer("timeout").pipe(
      Flag.withSchema(
        Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 900000 }))
      ),
      Flag.withDefault(180000)
    ),
    junit: Flag.string("junit").pipe(Flag.optional),
  },
  Effect.fn("eval.run")(function* (options) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = yield* safeEnvironment;
    if (!/^(launch|agent|browser)(\/[a-zA-Z0-9_-]+)*$/u.test(options.suite))
      return yield* new EvalFailed({
        message:
          "Use --suite launch, agent, browser, or a case below one of those directories.",
      });
    const selected = [
      options.suite,
      ...(Option.isSome(options.tag) ? ["--tag", options.tag.value] : []),
    ];
    if (options.list) {
      const child = yield* spawner.spawn(
        ChildProcess.make(
          "pnpm",
          ["exec", "eve", "eval", ...selected, "--list"],
          {
            env: environment,
            extendEnv: false,
            stdout: "inherit",
            stderr: "inherit",
          }
        )
      );
      if ((yield* child.exitCode) !== 0)
        return yield* new EvalFailed({ message: "Eval listing failed." });
      return undefined;
    }
    if (Option.isNone(options.url))
      return yield* new EvalFailed({
        message:
          "Start the built app against companion_runtime_test, then run pnpm eval:agent --url http://127.0.0.1:4351. Use --list to inspect cases without credentials.",
      });
    const origin = new URL(options.url.value);
    const database = new URL(
      environment.DATABASE_URL ?? "postgresql://invalid/"
    );
    if (
      !loopback(origin.hostname) ||
      origin.protocol !== "http:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      !loopback(database.hostname) ||
      database.pathname !== "/companion_runtime_test"
    )
      return yield* new EvalFailed({
        message:
          "The harness accepts only a loopback HTTP app and the isolated companion_runtime_test database. Production targets are refused.",
      });
    const { launchFixture } = yield* Effect.promise(
      () => import("./agent-evals/fixture")
    );
    const { launchTarget } = yield* Effect.promise(
      () => import("./agent-evals/target")
    );
    const { runtimeDatabase } = yield* Effect.promise(
      () => import("../tests/runtime/database")
    );
    const { WorkspaceRepository } = yield* Effect.promise(
      () => import("../server/workspaces/repository")
    );
    const fs = yield* FileSystem.FileSystem;
    const output = `.eve/launch-${randomUUID()}`;
    yield* fs.makeDirectory(output, { recursive: true });
    const failedReports: string[] = [];
    for (let index = 0; index < options.repeat; index++) {
      yield* Effect.gen(function* () {
        const fixture = yield* launchFixture();
        const target = yield* launchTarget(origin.origin, fixture);
        yield* Effect.tryPromise({
          try: () =>
            new Client({
              host: target.url,
              auth: { bearer: target.token },
              redirect: "error",
            }).health(),
          catch: () =>
            new EvalFailed({
              message:
                "The isolated proxy could not validate the native Eve health response.",
            }),
        });
        const report = `${output}/run-${String(index + 1)}.json`;
        const args = [
          "exec",
          "eve",
          "eval",
          ...selected,
          "--url",
          target.url,
          "--strict",
          "--max-concurrency",
          "1",
          "--timeout",
          String(options.timeout),
          ...(options.json ? ["--json"] : []),
          ...(Option.isSome(options.junit)
            ? [
                "--junit",
                options.repeat === 1
                  ? options.junit.value
                  : `${options.junit.value}.${String(index + 1)}.xml`,
              ]
            : []),
        ];
        const child = yield* spawner.spawn(
          ChildProcess.make("pnpm", args, {
            env: {
              ...environment,
              EVE_EVAL_AUTH_TOKEN: target.token,
              ZOEN_EVAL_REPORT: report,
            },
            extendEnv: false,
            stdout: "inherit",
            stderr: "inherit",
            forceKillAfter: "10 seconds",
          })
        );
        const code = yield* child.exitCode;
        if (!(yield* fs.exists(report)))
          return yield* new EvalFailed({
            message: `Eve exited with ${String(code)} before producing a report. Inspect its preceding configuration or transport error.`,
          });
        const receipt = yield* fs
          .readFileString(report)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.fromJsonString(summarySchema))
            )
          );
        if (!options.json)
          yield* Effect.log(`Native evaluation receipt: ${report}`);
        if (
          code !== 0 ||
          receipt.counts.passed === 0 ||
          receipt.counts.failed !== 0 ||
          receipt.counts.skipped !== 0 ||
          receipt.counts.scored !== 0
        )
          failedReports.push(report);
        return undefined;
      }).pipe(
        Effect.scoped,
        Effect.provide(
          WorkspaceRepository.layer.pipe(Layer.provideMerge(runtimeDatabase))
        )
      );
    }
    if (failedReports.length > 0)
      return yield* new EvalFailed({
        message: `Required evals did not all pass. Completed every requested repetition. Inspect ${failedReports.join(", ")} and the native .eve/evals artifacts.`,
      });
    return undefined;
  })
).pipe(
  Command.withDescription(
    "Run native Eve evals with a temporary synthetic Better Auth identity. Never forwards production channel credentials; rejects production targets; skipped cases fail the gate."
  ),
  Command.withExamples([
    {
      command: "pnpm eval:agent --list",
      description:
        "List launch cases without connecting to a provider or database.",
    },
    {
      command:
        "pnpm eval:agent --url http://127.0.0.1:4351 --tag executor --repeat 3",
      description:
        "Repeat the real-model Executor cases against an isolated built app.",
    },
    {
      command:
        "pnpm eval:agent --url http://127.0.0.1:4351 --junit .eve/launch.xml",
      description: "Run every required launch case and write CI receipts.",
    },
  ])
);

command.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.scoped,
  Effect.provide(NodeHttpServer.layerHttpServices),
  NodeRuntime.runMain
);
