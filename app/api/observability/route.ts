import { Effect, Schema, Stream } from "effect";
import { isSameOrigin } from "../../../web/trpc/same-origin";
import { serverRuntime } from "../../../server/runtime";
import { resolveWorkspaceActor } from "../../../server/workspaces/session";
import {
  ClientBatchSchema,
  ingestClientTelemetry,
} from "../../../server/observability/events";

export async function POST(request: Request) {
  if (!request.headers.has("origin") || !isSameOrigin(request) || !request.body)
    return new Response(null, { status: 403 });
  const body = request.body;
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const actor = yield* resolveWorkspaceActor(request.headers);
      const bytes = yield* Stream.fromReadableStream({
        evaluate: () => body,
        onError: () => new Error("Invalid telemetry request"),
      }).pipe(
        Stream.runFoldEffect(
          () => ({ size: 0, chunks: new Array<Uint8Array>() }),
          (state, chunk) => {
            if (state.size + chunk.length > 1_100_000)
              return Effect.fail(new Error("Telemetry request too large"));
            state.size += chunk.length;
            state.chunks.push(chunk);
            return Effect.succeed(state);
          }
        )
      );
      const batch = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(ClientBatchSchema)
      )(Buffer.concat(bytes.chunks).toString("utf8"));
      yield* ingestClientTelemetry(actor, batch);
      return new Response(null, { status: 204 });
    }).pipe(
      Effect.timeout("5 seconds"),
      Effect.catchCause(() =>
        Effect.succeed(new Response(null, { status: 400 }))
      )
    ),
    { signal: request.signal }
  );
}
