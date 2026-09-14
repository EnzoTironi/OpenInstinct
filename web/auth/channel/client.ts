import type { channelProviderSchema } from "@shared/identity/channel-auth";
import { Effect, Result, Schema } from "effect";
import {
  channelStartResultSchema,
  deviceBindingSchema,
  type deviceRequestSchema,
  deviceBoundSchema,
  channelChallengeStatusSchema,
  channelChallengeCompletionSchema,
  channelChallengeIdSchema,
  channelChallengeRequestSchema,
} from "@shared/identity/channel-auth";

const localCallbackSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      const decoded = decodeURIComponent(value);
      return (
        value.startsWith("/") &&
        !value.startsWith("//") &&
        !decoded.startsWith("//") &&
        !/[\\\s]/u.test(decoded) &&
        !decoded
          .split("")
          .some(
            (character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
          ) &&
        new URL(value, "https://callback.invalid").origin ===
          "https://callback.invalid"
      );
    } catch {
      return false;
    }
  })
);

export function safeCallbackUrl(value: string | undefined) {
  return Result.getOrElse(
    Schema.decodeUnknownResult(localCallbackSchema)(value),
    () => "/"
  );
}

interface SignOutResult {
  readonly data: { readonly success: boolean } | null;
  readonly error: {
    readonly status: number;
    readonly statusText: string;
  } | null;
}

export function reauthenticationDestination(
  outcome: PromiseSettledResult<SignOutResult>,
  callbackUrl: string
) {
  if (
    outcome.status === "rejected" ||
    outcome.value.error ||
    outcome.value.data?.success !== true
  )
    return undefined;
  return `/sign-in?callbackUrl=${encodeURIComponent(safeCallbackUrl(callbackUrl))}`;
}

export class ChannelAuthorizationError extends Schema.TaggedError<ChannelAuthorizationError>()(
  "ChannelAuthorizationError",
  {
    message: Schema.String,
    category: Schema.Literals(["terminal", "rate-limit", "transient"]),
    status: Schema.Number,
    retryAfter: Schema.NullOr(Schema.String),
  }
) {}

export function channelHttpError(
  status: number,
  retryAfter: string | null = null
) {
  const terminal = [400, 401, 403, 404, 409, 410, 412].includes(status);
  return new ChannelAuthorizationError({
    status,
    retryAfter,
    category: terminal
      ? "terminal"
      : status === 429
        ? "rate-limit"
        : "transient",
    message: terminal
      ? "This sign-in could not be verified in this browser. Start again and confirm the new request in chat."
      : status === 429
        ? "Too many attempts. Wait before trying again."
        : status === 503
          ? "Sign-in through this messenger is unavailable. Try the other messenger, or try again later."
          : "Unable to check sign-in. Check your connection and try again.",
  });
}

export function invalidChannelChallenge(status: number) {
  return new ChannelAuthorizationError({
    status,
    retryAfter: null,
    category: "terminal",
    message: "This sign-in request is invalid. Start again.",
  });
}

export type ChannelAuthorizationStatus =
  | typeof channelChallengeStatusSchema.Type.status
  | "invalid";

// Better Auth resets its attempt counter after an idle window, not periodically.
// Leave the default ten-second window between successful status requests.
export const channelAuthorizationPollIntervalMs = 10_000;

const retrySecondsSchema = Schema.String.check(Schema.isPattern(/^\d+$/u));
const retryDateSchema = Schema.String.check(
  Schema.isPattern(
    /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u
  )
);

export function channelPollFailure(
  failure: ChannelAuthorizationError,
  failures: number,
  now: number,
  expiresAt: number
) {
  if (now >= expiresAt)
    return { status: "expired" as const, failures, delay: 0 };
  if (failure.category === "terminal")
    return { status: "invalid" as const, failures, delay: 0 };
  const nextFailures =
    failure.category === "transient" ? failures + 1 : failures;
  if (nextFailures >= 5)
    return { status: "invalid" as const, failures: nextFailures, delay: 0 };
  const header = failure.retryAfter;
  const retryAfter =
    header === null
      ? Number.NaN
      : Schema.is(retrySecondsSchema)(header)
        ? Math.min(Number(header) * 1000, expiresAt - now)
        : Schema.is(retryDateSchema)(header)
          ? Date.parse(header) - now
          : Number.NaN;
  const fallback =
    failure.category === "rate-limit"
      ? 30_000
      : Math.min(2000 * 2 ** nextFailures, 30_000);
  const delay = Math.max(
    2000,
    Number.isFinite(retryAfter) ? retryAfter : fallback
  );
  return {
    status: "pending" as const,
    failures: nextFailures,
    delay: Math.min(delay, expiresAt - now),
  };
}

const requestJson = Effect.fn("channelAuthorization.request")(
  function* <A>(
    path: string,
    init: RequestInit,
    responseSchema: Schema.Codec<A, unknown>
  ) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`/api/auth/channel-auth/${path}`, {
          ...init,
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal,
        }),
      catch: () => channelHttpError(0),
    });
    if (!response.ok)
      return yield* channelHttpError(
        response.status,
        response.headers.get("Retry-After") ??
          response.headers.get("X-Retry-After")
      );
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () => channelHttpError(0),
    });
    return yield* Schema.decodeEffect(Schema.fromJsonString(responseSchema))(
      body
    ).pipe(Effect.mapError(() => invalidChannelChallenge(response.status)));
  },
  Effect.timeout("10 seconds"),
  Effect.catchTag("TimeoutError", () => Effect.fail(channelHttpError(0)))
);

export const startChannelAuthorization = Effect.fn(
  "channelAuthorization.start"
)(function* (
  channel: typeof channelProviderSchema.Type,
  purpose: typeof channelChallengeRequestSchema.Type.purpose
) {
  const intent = yield* Schema.decodeEffect(channelChallengeRequestSchema)({
    channel,
    purpose,
  }).pipe(Effect.mapError(() => channelHttpError(400)));
  const challenge = yield* requestJson(
    "start",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent),
    },
    channelStartResultSchema
  );
  if (challenge.channel !== channel) return yield* invalidChannelChallenge(200);
  return challenge;
});

export const checkChannelAuthorization = Effect.fn(
  "channelAuthorization.status"
)(function* (id: string) {
  const input = yield* Schema.decodeEffect(channelChallengeIdSchema)({
    id,
  }).pipe(Effect.mapError(() => channelHttpError(400)));
  return yield* requestJson(
    `status?id=${encodeURIComponent(input.id)}`,
    { method: "GET" },
    channelChallengeStatusSchema
  );
});

export const completeChannelAuthorization = Effect.fn(
  "channelAuthorization.complete"
)(function* (id: string) {
  const input = yield* Schema.decodeEffect(channelChallengeIdSchema)({
    id,
  }).pipe(Effect.mapError(() => channelHttpError(400)));
  yield* requestJson(
    "complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    channelChallengeCompletionSchema
  );
});

export function channelFailureMessage(
  failure: ChannelAuthorizationError,
  purpose: typeof channelChallengeRequestSchema.Type.purpose
) {
  if (failure.status === 412)
    return "Esta conta tem conexões, cofre ou acesso a equipes. A vinculação precisa de uma revisão para preservar esses acessos.";
  if (failure.status === 423)
    return "Aguarde as entregas em andamento terminarem e tente novamente.";
  if (purpose === "login") return failure.message;
  if (failure.status === 401)
    return "Sign in again before linking another channel, then return to Account to start a new request.";
  if (failure.status === 409)
    return "Este mensageiro já pertence a outra conta Zoen. Você pode preservar essa conta como arquivo e usar a conta atual para novas conversas.";
  if (failure.category === "terminal")
    return "This account-linking request could not be verified. Start a new request and confirm it in the messenger account you want to link.";
  return failure.message;
}

export const bindNativeBrowser = Effect.fn("channelAuthorization.bind")(
  function* (input: typeof deviceBindingSchema.Type) {
    const body = yield* Schema.decodeEffect(deviceBindingSchema)(input).pipe(
      Effect.mapError(() => channelHttpError(400))
    );
    return yield* requestJson(
      "device-bind",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      deviceBoundSchema
    );
  }
);

export const resumeNativeBrowser = (input: typeof deviceRequestSchema.Type) =>
  requestJson(
    `device?id=${encodeURIComponent(input.id)}&purpose=${input.purpose}`,
    { method: "GET" },
    deviceBoundSchema
  );
