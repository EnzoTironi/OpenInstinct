import { Effect, Schema } from "effect";
import type { SandboxToolInvoker } from "../../vendor/executor/core";
import { runCustomerCode } from "./runtime";
import {
  CustomerToolError,
  type CustomerToolSchema,
  decodeCustomerValue,
} from "../workspaces/tool-document";

export const executeCustomerCode = Effect.fn("Executor.customerCode")(
  function* (
    tool: typeof CustomerToolSchema.Type,
    input: Parameters<typeof decodeCustomerValue>[1],
    invoker: SandboxToolInvoker
  ) {
    const implementation = tool.implementation;
    if (implementation.kind !== "code")
      return yield* new CustomerToolError({ reason: "invalid_definition" });
    const decoded = yield* decodeCustomerValue(tool.inputSchema, input);
    const result = yield* runCustomerCode(
      `const input = ${JSON.stringify(decoded)};\nreturn await (async () => {\n${implementation.code}\n})();`,
      {
        invoke: (call) =>
          implementation.requires.includes(call.path)
            ? invoker.invoke(call)
            : Effect.fail(
                new CustomerToolError({ reason: "dependency_unavailable" })
              ),
      }
    );
    if (!result.ok)
      return yield* new CustomerToolError({ reason: "execution_failed" });
    const envelope = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(
        Schema.Struct({ result: Schema.Record(Schema.String, Schema.Unknown) })
      )
    )(result.text);
    return yield* decodeCustomerValue(tool.outputSchema, envelope.result, true);
  },
  Effect.catchTag(
    "SchemaError",
    () => new CustomerToolError({ reason: "invalid_output" })
  )
);
