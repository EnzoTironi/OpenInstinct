import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";

export const LearnedMemoryItemSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  memory: Schema.String.check(Schema.isMaxLength(8000)),
  createdAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});
const readResponse = Schema.Struct({
  results: Schema.Array(LearnedMemoryItemSchema).check(Schema.isMaxLength(200)),
});
const writeResponse = Schema.Struct({
  ids: Schema.Array(Schema.String.check(Schema.isUUID())),
});

class Mem0Error extends Schema.TaggedError<Mem0Error>()("Mem0Error", {
  reason: Schema.Literals([
    "unconfigured",
    "unavailable",
    "conflict",
    "not_found",
  ]),
}) {}

const makeMem0 = Effect.sync(() => {
  const request = Effect.fn("Mem0.request")(
    function* (body: {
      readonly namespace: string;
      readonly action:
        | "list"
        | "search"
        | "remember"
        | "update"
        | "delete"
        | "clear";
      readonly operation_id?: string;
      readonly text?: string;
      readonly memory_id?: string;
      readonly infer?: boolean;
    }) {
      const config = yield* Config.all({
        url: Config.nonEmptyString("ZOEN_MEM0_URL"),
        key: Config.redacted("ZOEN_MEM0_API_KEY"),
      }).pipe(Effect.mapError(() => new Mem0Error({ reason: "unconfigured" })));
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(new URL("/v1/memory", config.url), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${Redacted.value(config.key)}`,
            },
            body: JSON.stringify(body),
            signal,
            redirect: "error",
            cache: "no-store",
          }),
        catch: () => new Mem0Error({ reason: "unavailable" }),
      });
      if (!response.ok)
        return yield* new Mem0Error({
          reason:
            response.status === 409
              ? "conflict"
              : response.status === 404
                ? "not_found"
                : "unavailable",
        });
      return yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Mem0Error({ reason: "unavailable" }),
      });
    },
    Effect.timeout("45 seconds"),
    Effect.catchTag(
      "TimeoutError",
      () => new Mem0Error({ reason: "unavailable" })
    )
  );
  return {
    read: Effect.fn("Mem0.read")(function* (namespace: string, query?: string) {
      const result = yield* request({
        namespace,
        action: query ? "search" : "list",
        text: query,
      });
      return yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(readResponse)
      )(result).pipe(
        Effect.mapError(() => new Mem0Error({ reason: "unavailable" }))
      );
    }),
    mutate: Effect.fn("Mem0.mutate")(function* (
      input: Parameters<typeof request>[0]
    ) {
      const result = yield* request(input);
      return yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(writeResponse)
      )(result).pipe(
        Effect.mapError(() => new Mem0Error({ reason: "unavailable" }))
      );
    }),
  };
});

export class Mem0 extends Context.Service<
  Mem0,
  Effect.Success<typeof makeMem0>
>()("zoen/Mem0") {
  static readonly layer = Layer.effect(Mem0, makeMem0);
}
