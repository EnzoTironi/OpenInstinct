import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { justbash } from "eve/sandbox/just-bash";
import { Schema } from "effect";
import { expect, test } from "vitest";
import {
  computerScopeKey,
  embeddedRuntimeDecision,
  guestEnvironment,
} from "../../../server/operon-kernel";

test("the real Eve virtual shell keeps files session-private and blocks network access", async ({
  onTestFinished,
}) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.end("This must not enter the sandbox.");
  });
  server.listen(0, "127.0.0.1");
  onTestFinished(() => {
    server.close();
  });
  await once(server, "listening");
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Int }))(
    server.address()
  );
  const backend = justbash({ autoInstall: false });
  const sessionKey = randomUUID();
  const first = await backend.create({
    templateKey: null,
    sessionKey,
    runtimeContext: { appRoot: process.cwd() },
  });
  onTestFinished(() => first.delete());
  const second = await backend.create({
    templateKey: null,
    sessionKey: randomUUID(),
    runtimeContext: { appRoot: process.cwd() },
  });
  onTestFinished(() => second.delete());
  await first.session.writeTextFile({
    path: "private.txt",
    content: "Synthetic private note",
  });
  expect(await first.session.readTextFile({ path: "private.txt" })).toContain(
    "Synthetic private note"
  );
  expect(
    (await second.session.run({ command: "cat private.txt" })).exitCode
  ).not.toBe(0);
  const blocked = await first.session.run({
    command: `curl --max-time 2 http://127.0.0.1:${String(address.port)}`,
  });
  expect(blocked.exitCode).not.toBe(0);
  expect(blocked.stderr).toMatch(/not allowed|denied/i);
  expect(requests).toBe(0);
  const leaked = await first.session.run({ command: "printenv" });
  expect(`${leaked.stdout}\n${leaked.stderr}`).not.toMatch(
    /DATABASE_URL|BETTER_AUTH_SECRET|SECRET_ENCRYPTION_KEY|KERNEL_API_KEY/
  );
  expect(
    guestEnvironment({ DATABASE_URL: "postgresql://x", PATH: "/bin" })
  ).toEqual({ PATH: "/bin" });
  await first.delete();
  const resumed = await backend.create({
    templateKey: null,
    sessionKey,
    runtimeContext: { appRoot: process.cwd() },
  });
  onTestFinished(() => resumed.delete());
  expect(
    (await resumed.session.run({ command: "cat private.txt" })).exitCode
  ).not.toBe(0);
}, 15000);

test("pins Eve just-bash and does not install a second agent loop", () => {
  const sandbox = readFileSync("agent/sandbox.ts", "utf8");
  const agent = readFileSync("agent/agent.ts", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const manifest = readFileSync("package.json", "utf8");
  expect(embeddedRuntimeDecision).toEqual({
    agentOs: "no-go",
    secondAgentLoop: false,
    selected: "eve-just-bash",
  });
  expect(sandbox).toContain("justbash({ autoInstall: false })");
  expect(sandbox).toContain("computerSessionKey");
  expect(sandbox).not.toContain("defaultBackend");
  expect(sandbox).not.toContain("agentos");
  expect(agent.match(/defineAgent\(/g)?.length).toBe(1);
  expect(agent).not.toContain("agentos");
  expect(dockerfile).toContain("require.resolve('just-bash')");
  expect(manifest).toContain('"just-bash"');
  expect(manifest).not.toContain("@rivet-dev/agentos");
  expect(readFileSync("agent/tools/bash.ts", "utf8")).toContain(
    "disableTool()"
  );
  expect(
    computerScopeKey({
      kind: "private",
      userId: "better-auth:alice",
      workspaceId: "company:acme",
    })
  ).not.toBe(
    computerScopeKey({
      kind: "shared",
      audienceId: "binding:acme",
      workspaceId: "company:acme",
    })
  );
});
