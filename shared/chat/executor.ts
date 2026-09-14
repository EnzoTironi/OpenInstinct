import { Result, Schema } from "effect";

export const ExecutorCallSchema = Schema.Struct({
  path: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  input: Schema.Record(Schema.String, Schema.Unknown),
});
const ExecutorResultSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  output: Schema.Unknown,
});
export const ExecutorResourceSchema = Schema.Struct({
  path: Schema.NonEmptyString.check(Schema.isMaxLength(240)),
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u)),
});
export const ExecutorReceiptSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  status: Schema.Literals(["completed", "failed", "deferred"]),
  durationMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  resource: Schema.optionalKey(ExecutorResourceSchema),
});

/** Presentation only: authorization always resolves the original call at the host. */
export function executorActionName(
  toolName: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Eve action inputs are heterogeneous persisted payloads, decoded here.
  input: unknown
) {
  if (toolName !== "execute") return toolName;
  const parsed = Schema.decodeUnknownResult(
    Schema.Struct({ call: ExecutorCallSchema })
  )(input);
  return Result.isSuccess(parsed) ? parsed.success.call.path : "execute";
}

/** Accept only the host's structured call envelope, never names printed by code. */
export function executorActionResult(
  toolName: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Eve action results are heterogeneous persisted payloads, decoded here.
  output: unknown
) {
  const parsed =
    toolName === "execute"
      ? Schema.decodeUnknownResult(ExecutorResultSchema)(output)
      : null;
  return parsed && Result.isSuccess(parsed)
    ? { toolName: parsed.success.path, output: parsed.success.output }
    : { toolName, output };
}
