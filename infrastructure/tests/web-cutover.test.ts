import assert from "node:assert/strict";
// oxlint-disable-next-line vitest/no-import-node-test -- This isolated package uses the Node runner.
import { test } from "node:test";
import { credentials, Retry } from "@distilled.cloud/fly-io";
import type { Machine } from "@distilled.cloud/fly-io/machines";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { retireLegacyWeb } from "../web-cutover.ts";

const deployment = {
  app: "test-app",
  replacement: "new-web",
  legacy: "old-web",
  release: "registry.fly.io/test-app:test-release",
  volume: "vol_auth",
};
const ready: Machine = {
  id: "new-web",
  state: "started",
  config: {
    metadata: { "zoen.migrated-image": deployment.release },
    mounts: [{ path: "/root/.eve/auth", volume: deployment.volume }],
  },
  checks: [{ name: "alive", status: "passing" }],
};

function cutoverApi(legacy: Machine, replacement = ready) {
  const calls: { path: string; body?: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    const body: unknown = init?.body
      ? await new Response(init.body).json()
      : undefined;
    calls.push({ path, body });
    if (path.endsWith("/new-web")) return Response.json(replacement);
    if (path.endsWith("/stop")) {
      legacy.state = "stopped";
      return Response.json({});
    }
    if (path.endsWith("/wait")) return Response.json({});
    assert.ok(path.endsWith("/old-web"));
    return Response.json(legacy);
  };
  return {
    calls,
    run: () =>
      Effect.runPromise(
        retireLegacyWeb(deployment).pipe(
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

await test("checks the mounted replacement before removing legacy traffic and stopping it", async () => {
  const config = {
    image: "old-image",
    env: { EXISTING_SETTING: "preserved" },
    services: [{ internal_port: 3000, autostart: true }],
    restart: { policy: "always" },
  };
  const api = cutoverApi({
    id: "old-web",
    instance_id: "legacy-version",
    state: "started",
    config,
  });
  assert.deepEqual(await api.run(), {
    machine: "new-web",
    release: deployment.release,
  });
  assert.ok(api.calls[0].path.endsWith("/new-web"));
  const update = api.calls.find(
    ({ path, body }) => path.endsWith("/old-web") && body !== undefined
  );
  assert.deepEqual(update?.body, {
    config: { ...config, services: [], restart: { policy: "no" } },
    current_version: "legacy-version",
    skip_launch: true,
  });
  assert.ok(api.calls.at(-2)?.path.endsWith("/stop"));
  assert.ok(api.calls.at(-1)?.path.endsWith("/wait"));
});

await test("repeated deployment leaves the retained stopped machine untouched", async () => {
  const api = cutoverApi({
    id: "old-web",
    instance_id: "retired-version",
    state: "stopped",
    config: { services: [], restart: { policy: "no" } },
  });
  await api.run();
  assert.ok(api.calls.every(({ body }) => body === undefined));
  assert.ok(api.calls.every(({ path }) => !path.endsWith("/stop")));
});

await test("a failed readiness lookup cannot stop or mutate the serving machine", async () => {
  const calls: string[] = [];
  await assert.rejects(
    Effect.runPromise(
      retireLegacyWeb(deployment).pipe(
        Effect.timeout("50 millis"),
        Retry.none,
        Effect.provide(
          credentials({
            apiKey: "test-token",
            apiBaseUrl: "https://fly.invalid/v1",
          })
        ),
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, async (input) => {
          calls.push(
            new URL(input instanceof Request ? input.url : input).href
          );
          return Response.json(
            Object.assign({}, ready, {
              checks: [{ name: "alive", status: "critical" }],
            })
          );
        })
      )
    )
  );
  assert.ok(calls.length > 0);
  assert.ok(calls.every((path) => path.endsWith("/new-web")));
});

await test("refuses to retire the replacement itself", async () => {
  await assert.rejects(
    Effect.runPromise(
      retireLegacyWeb({ ...deployment, legacy: deployment.replacement }).pipe(
        Effect.provide(credentials({ apiKey: "test-token" })),
        Effect.provide(FetchHttpClient.layer)
      )
    ),
    /requires a new machine/
  );
});
