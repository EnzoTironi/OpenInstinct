import { Clock, Effect, Option, Result, Schema } from "effect";
import type { DynamicResolveContext, ToolContext } from "eve/tools";
import {
  isConnectionAuthorizationRequiredError,
  isConnectionAuthorizationFailedError,
  type ConnectionAuthorizationRequiredError,
  type ConnectionAuthorizationFailedError,
} from "eve/connections";
import {
  codeReadableTools,
  resolveExecutorTools,
  type ExecutorSurface,
} from "./catalog";
import { discoverExecutor } from "./discovery";
import { decodeToolInput } from "./schemas";
import { ExecutorCodeSchema, runWorkspaceCode } from "./runtime";
import { ExecutorCatalogError, executorFailure } from "./errors";
import {
  ExecutorCallSchema,
  type ExecutorReceiptSchema,
  ExecutorResourceSchema,
} from "@shared/chat/executor";

const Call = ExecutorCallSchema;
export const ExecutorInput = Schema.Struct({
  code: Schema.optionalKey(ExecutorCodeSchema),
  call: Schema.optionalKey(Call),
}).check(
  Schema.makeFilter(
    (input) =>
      (input.code === undefined) !== (input.call === undefined) ||
      "Supply either code or call."
  )
);

export function executorContext(
  context: Pick<ToolContext, "session">
): DynamicResolveContext {
  return { session: context.session, channel: {}, messages: [] };
}

export const resolveExecutorCall = Effect.fn("Executor.resolveCall")(function* (
  context: DynamicResolveContext,
  call: typeof Call.Type,
  surface: ExecutorSurface = "coordinator"
) {
  const tools = yield* resolveExecutorTools(context, surface);
  const tool = tools[call.path];
  if (!tool) return yield* new ExecutorCatalogError({ reason: "unavailable" });
  const input = yield* decodeToolInput(tool.inputSchema, call.input);
  return { tool, input };
});

export const invokeExecutorCall = Effect.fn("Executor.invokeCall")(function* (
  call: typeof Call.Type,
  context: ToolContext,
  surface: ExecutorSurface = "coordinator"
) {
  const { tool, input } = yield* resolveExecutorCall(
    executorContext(context),
    call,
    surface
  );
  const output: unknown = yield* Effect.tryPromise({
    try: async () => {
      // SAFETY: resolveExecutorCall decoded input through this exact tool's owning schema.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The catalog is heterogeneous; its callable parameter is intentionally never before decoding.
      const result: unknown = await tool.execute(input as never, {
        ...context,
        toolName: call.path,
      });
      return result;
    },
    catch: (cause) =>
      isConnectionAuthorizationRequiredError(cause) ||
      isConnectionAuthorizationFailedError(cause)
        ? cause
        : executorFailure(cause),
  });
  const modelOutput = tool.toModelOutput
    ? yield* Effect.tryPromise({
        try: async () => {
          // SAFETY: output was produced by this exact tool's executor, paired with its own projection.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Preserve the heterogeneous owner pairing at the projection boundary.
          return tool.toModelOutput?.(output as never);
        },
        catch: () => new ExecutorCatalogError({ reason: "execution_failed" }),
      })
    : undefined;
  return { path: call.path, output, modelOutput };
});

export const executeCodeMode = Effect.fn("Executor.executeCodeMode")(function* (
  code: string,
  execution: ToolContext,
  surface: ExecutorSurface = "coordinator"
) {
  const context = executorContext(execution);
  yield* resolveExecutorTools(context, surface);
  const services =
    yield* Effect.context<
      Effect.Services<ReturnType<typeof discoverExecutor>>
    >();
  let authorization:
    | ConnectionAuthorizationRequiredError
    | ConnectionAuthorizationFailedError
    | undefined;
  const calls: (typeof ExecutorReceiptSchema.Type)[] = [];
  const result = yield* runWorkspaceCode(code, {
    invoke: (call) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        const outcome = yield* Effect.gen(function* () {
          if (authorization) return yield* Effect.fail(authorization);
          if (
            call.path === "search" ||
            call.path === "describe.tool" ||
            call.path === "describe.skill"
          )
            return yield* discoverExecutor(
              context,
              call.path,
              call.args ?? {},
              surface
            );
          const input = yield* Schema.decodeUnknownEffect(Call)({
            path: call.path,
            input: call.args ?? {},
          });
          const resolved = yield* resolveExecutorCall(context, input, surface);
          if (
            !codeReadableTools.has(call.path) ||
            resolved.tool.approval !== undefined
          )
            return {
              status: "call_required",
              call: input,
              reason:
                "Invoke the tool named execute with {call: thisCall} instead of code, so Eve preserves its durable action and approval boundary. There is no execute.call tool.",
            };
          return (yield* invokeExecutorCall(input, execution, surface)).output;
        }).pipe(Effect.result);
        const deferred =
          Result.isSuccess(outcome) &&
          Schema.is(Schema.Struct({ status: Schema.Literal("call_required") }))(
            outcome.success
          );
        let receipt: typeof ExecutorReceiptSchema.Type = {
          path: call.path,
          status: Result.isFailure(outcome)
            ? "failed"
            : deferred
              ? "deferred"
              : "completed",
          durationMs: (yield* Clock.currentTimeMillis) - started,
        };
        if (
          Result.isSuccess(outcome) &&
          ["describe.skill", "workspace.files.read"].includes(call.path)
        ) {
          const resource = Schema.decodeUnknownOption(ExecutorResourceSchema)(
            outcome.success
          );
          if (Option.isSome(resource))
            receipt = { ...receipt, resource: resource.value };
        }
        calls.push(receipt);
        if (
          Result.isFailure(outcome) &&
          (outcome.failure instanceof ExecutorCatalogError ||
            Schema.isSchemaError(outcome.failure))
        ) {
          const error = executorFailure(outcome.failure);
          return { error: { code: error.reason, message: error.message } };
        }
        return yield* Effect.fromResult(outcome);
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (
              isConnectionAuthorizationRequiredError(error) ||
              isConnectionAuthorizationFailedError(error)
            )
              authorization = error;
          })
        ),
        Effect.provide(services)
      ),
  });
  // Authorization is a native Eve continuation, never a sandbox result or credential.
  if (authorization) return yield* Effect.fail(authorization);
  return { ...result, calls };
});
