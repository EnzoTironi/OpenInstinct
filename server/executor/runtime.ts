import { Effect, Schema, Semaphore } from "effect";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type * as QuickJSPackage from "quickjs-emscripten";
import {
  makeQuickJsExecutor,
  setQuickJSModule,
} from "../../vendor/executor/sandbox";
import type { SandboxToolInvoker } from "../../vendor/executor/core";

const kernel = makeQuickJsExecutor({
  timeoutMs: 250,
  maxWallTimeMs: 25_000,
  memoryLimitBytes: 16 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
});
const capacity = Semaphore.makeUnsafe(4);
export const ExecutorCodeSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(20_000)
);
class ExecutorError extends Schema.TaggedError<ExecutorError>()(
  "ExecutorError",
  {
    reason: Schema.Literals([
      "invalid_code",
      "limit_exceeded",
      "execution_failed",
    ]),
  }
) {}

/** No process, network, filesystem or credentials enter the JS isolate. */
export const runWorkspaceCode = Effect.fn("Executor.runWorkspaceCode")(
  function* (code: string, invoker: SandboxToolInvoker) {
    const input = yield* Schema.decodeUnknownEffect(ExecutorCodeSchema)(code);
    // Keep Emscripten beside its WASM asset even when Eve bundles the host.
    const quickJs = yield* Effect.tryPromise({
      try: () => {
        // Node's require is untyped; this literal resolves the pinned package and its declared exports.
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        const nativeQuickJS: typeof QuickJSPackage = createRequire(
          resolve(process.cwd(), "package.json")
        )("quickjs-emscripten");
        return nativeQuickJS.getQuickJS();
      },
      catch: () => new ExecutorError({ reason: "execution_failed" }),
    });
    setQuickJSModule(quickJs);
    let calls = 0;
    const bounded: SandboxToolInvoker = {
      invoke: Effect.fn("Executor.invoke")(function* (call) {
        if (
          ++calls > 12 ||
          Buffer.byteLength(JSON.stringify({ args: call.args })) > 16_384
        )
          return yield* new ExecutorError({ reason: "limit_exceeded" });
        return yield* invoker.invoke(call);
      }),
    };
    const result = yield* kernel.execute(input, bounded);
    if (result.error)
      return {
        ok: false,
        text:
          result.error.split("\n\n")[0]?.slice(0, 2000) ??
          "Code execution failed.",
        logs: result.logs ?? [],
      };
    if (result.result === undefined && !result.output?.length)
      return {
        ok: false,
        text: "No result was returned. Use an explicit return, for example: return await tools.workspace.files.list({}); A missing return does not mean the workspace is empty.",
        logs: result.logs ?? [],
      };
    const text = JSON.stringify({
      result: result.result ?? null,
      output: result.output ?? [],
    });
    if (Buffer.byteLength(text) > 131_072)
      return yield* new ExecutorError({ reason: "limit_exceeded" });
    return { ok: true, text, logs: result.logs ?? [] };
  },
  (execution) => capacity.withPermit(execution),
  Effect.timeout("30 seconds"),
  Effect.catchTag(
    "SchemaError",
    () => new ExecutorError({ reason: "invalid_code" })
  ),
  Effect.catchTag(
    ["TimeoutError", "QuickJsExecutionError"],
    () => new ExecutorError({ reason: "execution_failed" })
  )
);
