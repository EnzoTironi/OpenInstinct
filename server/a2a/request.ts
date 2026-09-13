import { Effect, Schema, Stream } from "effect";
import { A2AError } from "./tasks";

const RpcRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Number]),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown),
});
export const TaskQuery = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  historyLength: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(50)
    )
  ),
});

export const readRpcRequest = Effect.fn("readRpcRequest")(function* (
  request: Request
) {
  if (!request.body)
    return yield* new A2AError({
      code: -32600,
      message: "Request body is required",
    });
  const version = request.headers.get("A2A-Version");
  if (version && version !== "1.0")
    return yield* new A2AError({
      code: -32009,
      message: "Supported A2A version: 1.0",
    });
  const source = request.body;
  const body = yield* Stream.fromReadableStream({
    evaluate: () => source,
    onError: () =>
      new A2AError({ code: -32700, message: "Cannot read request" }),
    releaseLockOnEnd: true,
  }).pipe(
    Stream.runFoldEffect(
      () => ({ size: 0, chunks: new Array<Uint8Array>() }),
      (acc, chunk) => {
        if (acc.size + chunk.length > 40 * 1024)
          return Effect.fail(
            new A2AError({ code: -32600, message: "Request exceeds 40 KiB" })
          );
        return Effect.sync(() => {
          acc.size += chunk.length;
          acc.chunks.push(chunk);
          return acc;
        });
      }
    ),
    Effect.map(({ chunks, size }) =>
      Buffer.concat(chunks, size).toString("utf8")
    ),
    Effect.timeout("5 seconds"),
    Effect.ensuring(
      Effect.tryPromise({
        try: () => source.cancel(),
        catch: () =>
          new A2AError({ code: -32700, message: "Cannot close request" }),
      }).pipe(Effect.timeout("100 millis"), Effect.ignore)
    )
  );
  const json = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Unknown)
  )(body).pipe(
    Effect.mapError(
      () => new A2AError({ code: -32700, message: "Invalid JSON" })
    )
  );
  return yield* Schema.decodeUnknownEffect(RpcRequest)(json, {
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError(
      () => new A2AError({ code: -32600, message: "Invalid JSON-RPC request" })
    )
  );
});
