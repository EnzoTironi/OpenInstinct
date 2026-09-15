import assert from "node:assert/strict";
// oxlint-disable-next-line vitest/no-import-node-test -- This isolated package uses the Node runner.
import { test } from "node:test";
import { credentials, Retry } from "@distilled.cloud/fly-io";
import { Deferred, Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { prepareServiceDatabases } from "../database.ts";

const commandSchema = Schema.Struct({ command: Schema.Array(Schema.String) });
const input = {
  app: "test-app",
  machine: "machine-1",
  release: "registry.fly.io/test@sha256:verified",
  credentialVersion: "all-service-credential-versions",
};

function databaseApi(execute: (command: string) => Promise<Response>) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const request = new Request(url, init);
    assert.equal(
      request.url,
      "https://fly.invalid/v1/apps/test-app/machines/machine-1/exec"
    );
    const body = Schema.decodeUnknownSync(commandSchema)(await request.json());
    const command = body.command[0];
    assert.ok(command);
    calls.push(command);
    return execute(command);
  };
  return {
    calls,
    run: () =>
      Effect.runPromise(
        prepareServiceDatabases(input).pipe(
          Retry.none,
          Effect.provide(
            credentials({
              apiKey: "test-token",
              apiBaseUrl: "https://fly.invalid/v1",
            })
          ),
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, fetch)
        )
      ),
  };
}

void test("waits for each bootstrap before starting the next shared-catalog mutation", async () => {
  const started = await Effect.runPromise(Deferred.make<undefined>());
  const release = await Effect.runPromise(Deferred.make<undefined>());
  const api = databaseApi(async (command) => {
    if (command.endsWith("bootstrap-application.sh")) {
      await Effect.runPromise(Deferred.succeed(started, undefined));
      await Effect.runPromise(Deferred.await(release));
    }
    return Response.json({ exit_code: 0, stdout: "", stderr: "" });
  });
  const running = api.run();
  try {
    await Effect.runPromise(Deferred.await(started));
    assert.deepEqual(api.calls, [
      "pg_isready",
      "/usr/local/bin/bootstrap-application.sh",
    ]);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
  }
  assert.deepEqual(await running, {
    release: input.release,
    credentialVersion: input.credentialVersion,
  });
  assert.deepEqual(api.calls, [
    "pg_isready",
    "/usr/local/bin/bootstrap-application.sh",
    "/usr/local/bin/bootstrap-memory.sh",
    "/usr/local/bin/bootstrap-matrix.sh",
    "/usr/local/bin/bootstrap-vaultwarden.sh",
  ]);
});

for (const database of ["application", "memory", "matrix", "vaultwarden"]) {
  void test(`stops after ${database} fails and keeps command output private`, async () => {
    const failure = `/usr/local/bin/bootstrap-${database}.sh`;
    const api = databaseApi(async (command) =>
      Response.json({
        exit_code: command === failure ? 1 : 0,
        stdout: "synthetic-sensitive-command-output",
        stderr: "synthetic-sensitive-error-output",
      })
    );
    await assert.rejects(api.run(), (error) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        new RegExp(`${database} database bootstrap failed`)
      );
      assert.doesNotMatch(error.message, /synthetic-sensitive/);
      return true;
    });
    assert.equal(api.calls.at(-1), failure);
  });
}
