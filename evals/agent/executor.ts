import type { EveEvalTurn } from "eve/evals";
import { Result, Schema } from "effect";
import {
  ExecutorCallSchema,
  ExecutorReceiptSchema,
} from "../../shared/chat/executor";

const callSchema = Schema.Struct({ call: ExecutorCallSchema });
const receiptSchema = Schema.Struct({
  calls: Schema.Array(ExecutorReceiptSchema),
});
const codeResultSchema = Schema.Struct({ ok: Schema.Boolean });

export function executorAttemptFailures(calls: EveEvalTurn["toolCalls"]) {
  return {
    native: calls.filter((call) => call.status === "failed").length,
    code: calls.filter((call) => {
      if (call.name !== "execute") return false;
      const parsed = Schema.decodeUnknownResult(codeResultSchema)(call.output);
      return Result.isSuccess(parsed) && !parsed.success.ok;
    }).length,
    host: calls.reduce((total, call) => {
      if (call.name !== "execute") return total;
      const parsed = Schema.decodeUnknownResult(receiptSchema)(call.output);
      return (
        total +
        (Result.isSuccess(parsed)
          ? parsed.success.calls.filter((item) => item.status === "failed")
              .length
          : 0)
      );
    }, 0),
  };
}

export function executorInput(
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decode the public heterogeneous Eve tool event.
  input: unknown
) {
  const parsed = Schema.decodeUnknownResult(callSchema)(input);
  return Result.isSuccess(parsed) && parsed.success.call.path === path
    ? parsed.success.call.input
    : undefined;
}

/** Count actual host invocations, including blocked attempts; never inspect program text. */
export function executorInvocations(
  turn: Pick<EveEvalTurn, "toolCalls">,
  path: string
) {
  return turn.toolCalls.reduce((total, call) => {
    if (call.name !== "execute") return total;
    if (executorInput(path, call.input)) return total + 1;
    const receipt = Schema.decodeUnknownResult(receiptSchema)(call.output);
    return (
      total +
      (Result.isSuccess(receipt)
        ? receipt.success.calls.filter((item) => item.path === path).length
        : 0)
    );
  }, 0);
}
