import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  SUPERVISOR_TEST_TIMEOUT_MS,
  waitForSupervisorClose,
  waitForSupervisorLogEntry,
} from "./helpers/supervisor-process";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe(
  "native agent eval CLI",
  { timeout: SUPERVISOR_TEST_TIMEOUT_MS },
  () => {
    it("lists selected cases without connecting to a database and filters child credentials", async () => {
      const result = await runSupervisor([
        "--list",
        "--suite",
        "launch",
        "--tag",
        "executor",
      ]);
      expect(result.code).toBe(0);
      const command = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({
            args: Schema.Array(Schema.String),
            environment: Schema.Array(Schema.String),
          })
        )
      )(result.commands);
      expect(command.args).toEqual([
        "exec",
        "eve",
        "eval",
        "launch",
        "--tag",
        "executor",
        "--list",
      ]);
      expect(command.environment).toEqual(
        expect.arrayContaining(["AI_GATEWAY_API_KEY", "PATH"])
      );
      for (const name of [
        "TELEGRAM_BOT_TOKEN",
        "KAPSO_API_KEY",
        "GOOGLE_CLIENT_SECRET",
        "STRIPE_SECRET_KEY",
        "KERNEL_API_KEY",
      ])
        expect(command.environment).not.toContain(name);
    });

    it.each([
      ["missing target", [], "Start the built app"],
      [
        "remote target",
        ["--url", "https://example.com"],
        "Production targets are refused",
      ],
      [
        "target credentials",
        ["--url", "http://user:pass@localhost:4351"],
        "Production targets are refused",
      ],
      [
        "target path",
        ["--url", "http://localhost:4351/other"],
        "Production targets are refused",
      ],
      [
        "path traversal",
        ["--suite", "launch/../../other"],
        "Use --suite launch",
      ],
      [
        "unsupported concurrency",
        ["--max-concurrency", "8"],
        "Unrecognized flag",
      ],
      ["unbounded repetitions", ["--repeat", "1000"], "20"],
    ])(
      "rejects %s before starting a provider or child process",
      async (_name, args, message) => {
        const result = await runSupervisor(args);
        expect(result.code).not.toBe(0);
        expect(result.commands).toBe("");
        expect(result.output).toContain(message);
      }
    );

    it("refuses a production database even with a loopback target", async () => {
      const result = await runSupervisor(["--url", "http://127.0.0.1:4351"], {
        database: "postgresql://test:test@example.com/companion_runtime_test",
      });
      expect(result.code).not.toBe(0);
      expect(result.commands).toBe("");
      expect(result.output).toContain("Production targets are refused");
    });

    it("propagates a failed native listing", async () => {
      const result = await runSupervisor(["--list"], { exitCode: 1 });
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("Eval listing failed");
    });

    it("terminates its child when interrupted", async () => {
      const result = await runSupervisor(["--list"], { interrupt: true });
      expect(result.code).not.toBe(0);
      expect(result.commands).toContain("terminated");
    });
  }
);

async function runSupervisor(
  args: string[],
  options: { database?: string; exitCode?: number; interrupt?: boolean } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "zoen-evals-cli-"));
  temporaryDirectories.push(directory);
  const logPath = join(directory, "commands.log");
  const pnpmPath = join(directory, "pnpm");
  await writeFile(
    pnpmPath,
    `#!${process.execPath}
const fs = require("node:fs");
const log = ${JSON.stringify(logPath)};
fs.appendFileSync(log, JSON.stringify({ args: process.argv.slice(2), environment: Object.keys(process.env).sort() }) + "\\n");
if (${String(options.interrupt ?? false)}) {
  process.on("SIGTERM", () => { fs.appendFileSync(log, "terminated\\n"); process.exit(143); });
  process.on("SIGINT", () => { fs.appendFileSync(log, "terminated\\n"); process.exit(130); });
  setInterval(() => {}, 1000);
} else process.exit(${String(options.exitCode ?? 0)});
`
  );
  await chmod(pnpmPath, 0o755);
  const supervisor = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      new URL("../scripts/run-agent-evals.ts", import.meta.url).pathname,
      ...args,
    ],
    {
      env: {
        PATH: directory,
        AI_GATEWAY_API_KEY: "synthetic-model-key",
        TELEGRAM_BOT_TOKEN: "must-not-be-forwarded",
        KAPSO_API_KEY: "must-not-be-forwarded",
        GOOGLE_CLIENT_SECRET: "must-not-be-forwarded",
        STRIPE_SECRET_KEY: "must-not-be-forwarded",
        KERNEL_API_KEY: "must-not-be-forwarded",
        NODE_ENV: "test",
        DATABASE_URL: options.database,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  for (const stream of [supervisor.stdout, supervisor.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
  }
  const closed = waitForSupervisorClose(supervisor);
  if (options.interrupt) {
    await waitForSupervisorLogEntry(logPath, '"eval"');
    supervisor.kill("SIGINT");
  }
  return {
    code: await closed,
    commands: await readFile(logPath, "utf8").catch(() => ""),
    output,
  };
}
