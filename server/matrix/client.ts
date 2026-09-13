import { Effect, Redacted, Schema } from "effect";
import { env } from "@shared/environment";

export class MatrixError extends Schema.TaggedError<MatrixError>()(
  "MatrixError",
  {
    reason: Schema.Literals(["unavailable", "forbidden", "conflict"]),
  }
) {}

export const matrixConfiguration = Effect.gen(function* () {
  if (
    !env.ZOEN_MATRIX_URL ||
    !env.ZOEN_MATRIX_SERVER_NAME ||
    !env.ZOEN_MATRIX_AS_TOKEN ||
    !env.ZOEN_MATRIX_HS_TOKEN
  )
    return yield* new MatrixError({ reason: "unavailable" });
  return {
    url: env.ZOEN_MATRIX_URL,
    serverName: env.ZOEN_MATRIX_SERVER_NAME,
    token: env.ZOEN_MATRIX_AS_TOKEN,
    homeserverToken: env.ZOEN_MATRIX_HS_TOKEN,
    botId: `@_zoen_bot:${env.ZOEN_MATRIX_SERVER_NAME}`,
  };
});

/** Only a configured homeserver is reachable. Tokens never enter URLs or logs. */
export const matrixRequest = Effect.fn("matrix.request")(function* (
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: typeof Schema.Json.Type,
  userId?: string
) {
  const config = yield* matrixConfiguration;
  const url = new URL(`/_matrix/client/v3/${path}`, config.url);
  if (userId) url.searchParams.set("user_id", userId);
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const options: RequestInit = {
        method,
        signal,
        redirect: "error",
        headers: {
          authorization: `Bearer ${Redacted.value(config.token)}`,
          "content-type": "application/json",
        },
      };
      if (body !== undefined && method !== "GET")
        options.body = JSON.stringify(body);
      const response = await fetch(url, options);
      if (!response.ok) {
        const error = Schema.decodeUnknownSync(
          Schema.Struct({ errcode: Schema.optional(Schema.String) })
        )(await response.json());
        throw new MatrixError({
          reason:
            error.errcode === "M_USER_IN_USE" ||
            error.errcode === "M_ROOM_IN_USE"
              ? "conflict"
              : response.status === 403
                ? "forbidden"
                : "unavailable",
        });
      }
      return Schema.decodeUnknownSync(Schema.Json)(await response.json());
    },
    catch: (error) =>
      error instanceof MatrixError
        ? error
        : new MatrixError({ reason: "unavailable" }),
  }).pipe(Effect.timeout("20 seconds"));
});

export const MatrixEventSchema = Schema.Struct({
  event_id: Schema.String,
  room_id: Schema.optional(Schema.String),
  type: Schema.String,
  sender: Schema.String,
  state_key: Schema.optional(Schema.String),
  origin_server_ts: Schema.optional(Schema.Number),
  content: Schema.Struct({
    body: Schema.optional(Schema.String),
    msgtype: Schema.optional(Schema.String),
    membership: Schema.optional(Schema.String),
  }),
});
