import { Effect, Result } from "effect";
import { expect, test } from "vitest";
import { runWorkspaceCode } from "./runtime";

test("the owned Executor kernel has no ambient process, network or filesystem", async () => {
  const result = await Effect.runPromise(
    runWorkspaceCode(
      "return [typeof process, typeof require, typeof fetch, typeof WebSocket, 6 * 7];",
      { invoke: () => Effect.die("No tool should be called") }
    )
  );
  expect(result).toMatchObject({ ok: true });
  expect(JSON.parse(result.text)).toMatchObject({
    result: ["undefined", "undefined", "function", "undefined", 42],
  });
  const network = await Effect.runPromise(
    runWorkspaceCode('return await fetch("https://example.invalid");', {
      invoke: () => Effect.die("No tool should be called"),
    })
  );
  expect(network.ok).toBe(false);
  expect(network.text).toContain("fetch is disabled");
});

test("CPU, logs, host calls and output are bounded", async () => {
  const invoker = { invoke: () => Effect.succeed({ value: 1 }) };
  const infinite = await Effect.runPromise(
    runWorkspaceCode("while (true) {}", invoker)
  );
  expect(infinite.ok).toBe(false);
  const logged = await Effect.runPromise(
    runWorkspaceCode(
      'for(let i=0;i<100;i++) console.log("x".repeat(3000)); return 1;',
      invoker
    )
  );
  expect(logged.logs).toHaveLength(64);
  expect(logged.logs.every((line) => line.length < 1040)).toBe(true);
  const excessive = await Effect.runPromise(
    runWorkspaceCode("for(let i=0;i<13;i++) await tools.example({});", invoker)
  );
  expect(excessive.ok).toBe(false);
  const output = await Effect.runPromise(
    runWorkspaceCode('return "x".repeat(140000);', invoker).pipe(Effect.result)
  );
  expect(Result.isFailure(output) && output.failure).toMatchObject({
    reason: "limit_exceeded",
  });
});

test("the bridge never exposes a failed host operation's private details", async () => {
  const result = await Effect.runPromise(
    runWorkspaceCode("return await tools.secret({});", {
      invoke: () => Effect.fail(new Error("PRIVATE TOKEN IN HOST ERROR")),
    })
  );
  expect(result.ok).toBe(false);
  expect(result.text).not.toContain("PRIVATE TOKEN");
});

test("a missing return is not misreported as empty workspace data", async () => {
  let calls = 0;
  const result = await Effect.runPromise(
    runWorkspaceCode("const files = await tools.list({}); files", {
      invoke: () =>
        Effect.sync(() => {
          calls += 1;
          return { files: ["knowledge/launch.md"] };
        }),
    })
  );
  expect(calls).toBe(1);
  expect(result.ok).toBe(false);
  expect(result.text).toContain("explicit return");
});
