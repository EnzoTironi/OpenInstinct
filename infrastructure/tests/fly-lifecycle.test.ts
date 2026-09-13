import assert from "node:assert/strict";
// oxlint-disable-next-line vitest/no-import-node-test -- This isolated package uses the Node runner.
import { test } from "node:test";
import { credentials, Retry } from "@distilled.cloud/fly-io";
import type { Machine } from "@distilled.cloud/fly-io/machines";
import { ensureStarted } from "alchemy/Fly/replicas";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

// Exercise the installed provider, including the Fly SDK's error decoding.
interface ApiError {
  status: number;
  message: string;
}

function machineApi({
  startError,
  waitError,
}: { startError?: ApiError; waitError?: ApiError } = {}) {
  const calls: { operation: string; method?: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const operation = url.pathname.split("/").at(-1) ?? "";
    calls.push({ operation, method: init?.method });
    if (operation === "start" && startError) {
      return Response.json(
        { error: startError.message },
        { status: startError.status }
      );
    }
    if (operation === "wait" && waitError) {
      return Response.json(
        { error: waitError.message },
        { status: waitError.status }
      );
    }
    if (operation === "machine-1") {
      return Response.json({
        id: "machine-1",
        state: "started",
        instance_id: "new-version",
      });
    }
    assert.ok(
      ["start", "wait"].includes(operation),
      `Unexpected operation: ${operation}`
    );
    return Response.json({});
  };
  return {
    calls,
    run: (machine: Machine, skipLaunch = false) =>
      Effect.runPromise(
        ensureStarted("test-app", machine, skipLaunch).pipe(
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

for (const state of [
  "replacing",
  "updating",
  "creating",
  "starting",
  "restarting",
  "started",
]) {
  void test(`waits for a ${state} machine without starting it again`, async () => {
    const api = machineApi();
    const result = await api.run({ id: "machine-1", state });
    assert.equal(result.instance_id, "new-version");
    assert.deepEqual(
      api.calls.map(({ operation }) => operation),
      ["wait", "machine-1"]
    );
  });
}

for (const state of ["created", "stopped", "suspended", "failed"]) {
  void test(`starts a ${state} machine before waiting`, async () => {
    const api = machineApi();
    await api.run({ id: "machine-1", state });
    assert.deepEqual(
      api.calls.map(({ operation }) => operation),
      ["start", "wait", "machine-1"]
    );
    assert.equal(api.calls[0].method, "POST");
  });
}

await test("waits if a stopped machine begins replacement before the start request", async () => {
  const api = machineApi({
    startError: {
      status: 412,
      message:
        "failed_precondition: machine getting replaced, refusing to start",
    },
  });
  assert.equal(
    (await api.run({ id: "machine-1", state: "stopped" })).state,
    "started"
  );
  assert.deepEqual(
    api.calls.map(({ operation }) => operation),
    ["start", "wait", "machine-1"]
  );
});

await test("preserves unrelated start failures", async () => {
  const api = machineApi({
    startError: {
      status: 412,
      message: "failed_precondition: invalid machine configuration",
    },
  });
  await assert.rejects(
    api.run({ id: "machine-1", state: "stopped" }),
    /invalid machine configuration/
  );
  assert.deepEqual(
    api.calls.map(({ operation }) => operation),
    ["start"]
  );
});

await test("preserves wait authorization failures", async () => {
  const api = machineApi({
    waitError: { status: 403, message: "access denied" },
  });
  await assert.rejects(
    api.run({ id: "machine-1", state: "replacing" }),
    /access denied/
  );
  assert.deepEqual(
    api.calls.map(({ operation }) => operation),
    ["wait"]
  );
});

await test("skipLaunch and unidentified machines never call Fly", async () => {
  const api = machineApi();
  const machine = { id: "machine-1", state: "created" };
  assert.equal(await api.run(machine, true), machine);
  const unidentified = { state: "created" };
  assert.equal(await api.run(unidentified), unidentified);
  assert.deepEqual(api.calls, []);
});
