import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { justbash } from "eve/sandbox/just-bash";
import { Schema } from "effect";
import { expect, test } from "vitest";

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
  const first = await backend.create({
    templateKey: null,
    sessionKey: randomUUID(),
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
}, 15000);
