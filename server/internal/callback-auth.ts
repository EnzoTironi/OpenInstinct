import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import {
  Clock,
  Config,
  Effect,
  Option,
  Redacted,
  Schema,
  Stream,
} from "effect";
import { routeAuth, vercelOidc } from "eve/channels/auth";

export const internalCallbackBodies = {
  "/internal/channel-input/respond": Schema.Struct({
    sessionId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    identityId: Schema.String.check(Schema.isUUID()),
    sourceMessageId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    turnId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    requestId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    decision: Schema.Literals(["approve", "cancel"]),
  }),
  "/internal/scheduled-run/report": Schema.Struct({
    runId: Schema.String.check(Schema.isUUID()),
  }),
  "/internal/scheduled-run/respond": Schema.Struct({
    answer: Schema.String.check(
      Schema.isTrimmed(),
      Schema.isMinLength(1),
      Schema.isMaxLength(8000)
    ),
    leaseToken: Schema.String.check(Schema.isUUID()),
    runId: Schema.String.check(Schema.isUUID()),
  }),
};
export type InternalCallbackRoute = keyof typeof internalCallbackBodies;

export class InternalCallbackRejected extends Schema.TaggedError<InternalCallbackRejected>()(
  "InternalCallbackRejected",
  { status: Schema.Literals([400, 401, 408, 413, 503]) }
) {}

const reject = (status: InternalCallbackRejected["status"]) =>
  new InternalCallbackRejected({ status });
const originSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  })
);

export const internalCallbackOrigin = Config.string("BETTER_AUTH_URL").pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(originSchema)),
  Effect.map((value) => new URL(value).origin),
  Effect.mapError(() => reject(503))
);
const callbackKey = Effect.gen(function* () {
  const installation = yield* ResolvedInstallationSecrets;
  const secret = yield* Schema.decodeUnknownEffect(
    Schema.String.check(
      Schema.isBase64(),
      Schema.makeFilter((value) => Buffer.from(value, "base64").length === 32)
    )
  )(Redacted.value(installation.secretEncryptionKey));
  return Redacted.make(
    createHmac("sha256", Buffer.from(secret, "base64"))
      .update("companion/internal-callback/v1")
      .digest()
  );
}).pipe(Effect.mapError(() => reject(503)));

function signature(
  key: Redacted.Redacted<Buffer>,
  origin: string,
  route: InternalCallbackRoute,
  timestamp: string,
  body: Uint8Array
) {
  return createHmac("sha256", Redacted.value(key))
    .update(
      JSON.stringify([
        "v1",
        origin,
        "POST",
        route,
        timestamp,
        createHash("sha256").update(body).digest("hex"),
      ])
    )
    .digest();
}

export const internalCallbackHeaders = Effect.fn("internalCallbackHeaders")(
  function* (route: InternalCallbackRoute, body: string) {
    const origin = yield* internalCallbackOrigin;
    const key = yield* callbackKey;
    const timestamp = String(
      Math.floor((yield* Clock.currentTimeMillis) / 1000)
    );
    return new Headers({
      "content-type": "application/json",
      "x-internal-callback-time": timestamp,
      "x-internal-callback-signature": signature(
        key,
        origin,
        route,
        timestamp,
        Buffer.from(body)
      ).toString("hex"),
    });
  }
);

const readInternalCallbackBody = Effect.fn("readInternalCallbackBody")(
  function* (request: Request) {
    if (!request.body) return yield* reject(400);
    const source = request.body;
    const cancel = Effect.tryPromise({
      try: () => source.cancel(),
      catch: () => reject(400),
    }).pipe(Effect.interruptible, Effect.timeout("100 millis"), Effect.ignore);
    return yield* Stream.fromReadableStream({
      evaluate: () => source,
      onError: () => reject(400),
      releaseLockOnEnd: true,
    }).pipe(
      Stream.runFoldEffect(
        () => ({ size: 0, chunks: new Array<Uint8Array>() }),
        (acc, chunk) => {
          if (acc.size + chunk.length > 64 * 1024)
            return Effect.fail(reject(413));
          return Effect.sync(() => {
            acc.size += chunk.length;
            acc.chunks.push(chunk);
            return acc;
          });
        }
      ),
      Effect.map(({ chunks, size }) => Buffer.concat(chunks, size)),
      Effect.timeout("5 seconds"),
      Effect.catchTag("TimeoutError", () => Effect.fail(reject(408))),
      Effect.ensuring(cancel)
    );
  }
);

export const readVerifiedInternalCallback = Effect.fn(
  "readVerifiedInternalCallback"
)(function* (request: Request, route: InternalCallbackRoute) {
  const origin = yield* internalCallbackOrigin;
  const key = yield* callbackKey;
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== route || url.search)
    return yield* reject(401);
  const timestamp = yield* Schema.decodeUnknownEffect(
    Schema.String.check(Schema.isPattern(/^\d{10}$/u))
  )(request.headers.get("x-internal-callback-time")).pipe(
    Effect.mapError(() => reject(401))
  );
  const age =
    Math.floor((yield* Clock.currentTimeMillis) / 1000) - Number(timestamp);
  if (age < -5 || age > 60) return yield* reject(401);
  const encoded = yield* Schema.decodeUnknownEffect(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))
  )(request.headers.get("x-internal-callback-signature")).pipe(
    Effect.mapError(() => reject(401))
  );
  const body = yield* readInternalCallbackBody(request);
  const expected = signature(key, origin, route, timestamp, body);
  if (!timingSafeEqual(Buffer.from(encoded, "hex"), expected))
    return yield* reject(401);
  // Authentication is time-bounded, not single-use. The existing run/report claim fences dispatch.
  return body;
});

export const readAuthenticatedInternalCallback = Effect.fn(
  "readAuthenticatedInternalCallback"
)(
  function* (request: Request, route: InternalCallbackRoute) {
    const vercel = yield* Config.option(Config.string("VERCEL_ENV"));
    if (Option.isSome(vercel)) {
      const auth = yield* Effect.tryPromise({
        try: () => routeAuth(request, [vercelOidc()]),
        catch: () => new InternalCallbackRejected({ status: 503 }),
      });
      if (auth instanceof Response) return auth;
      return yield* readInternalCallbackBody(request);
    }
    return yield* readVerifiedInternalCallback(request, route);
  },
  Effect.catchTag("ConfigError", () =>
    Effect.fail(new InternalCallbackRejected({ status: 503 }))
  )
);
