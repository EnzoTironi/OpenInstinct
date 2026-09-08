import type { channelProviderSchema } from "@shared/identity/channel-auth";
import { Effect, Result, Schema } from "effect";
import {
  channelChallengeSchema,
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

export class ChannelLoginError extends Schema.TaggedError<ChannelLoginError>()(
  "ChannelLoginError",
  {
    message: Schema.String,
    category: Schema.Literals(["terminal", "rate-limit", "transient"]),
    status: Schema.Number,
    retryAfter: Schema.NullOr(Schema.String),
  }
) {}

export function loginHttpError(
  status: number,
  retryAfter: string | null = null
) {
  const terminal = [400, 401, 403, 404, 409, 410].includes(status);
  return new ChannelLoginError({
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
  return new ChannelLoginError({
    status,
    retryAfter: null,
    category: "terminal",
    message: "This sign-in request is invalid. Start again.",
  });
}

export type ChannelLoginStatus =
  | typeof channelChallengeStatusSchema.Type.status
  | "invalid";

const retrySecondsSchema = Schema.String.check(Schema.isPattern(/^\d+$/u));
const retryDateSchema = Schema.String.check(
  Schema.isPattern(
    /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u
  )
);

export function loginPollFailure(
  failure: ChannelLoginError,
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

const requestJson = Effect.fn("channelLogin.request")(
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
      catch: () => loginHttpError(0),
    });
    if (!response.ok)
      return yield* loginHttpError(
        response.status,
        response.headers.get("Retry-After")
      );
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () => loginHttpError(0),
    });
    return yield* Schema.decodeEffect(Schema.fromJsonString(responseSchema))(
      body
    ).pipe(Effect.mapError(() => invalidChannelChallenge(response.status)));
  },
  Effect.timeout("10 seconds"),
  Effect.catchTag("TimeoutError", () => Effect.fail(loginHttpError(0)))
);

export const startChannelLogin = Effect.fn("channelLogin.start")(function* (
  channel: typeof channelProviderSchema.Type
) {
  const intent = yield* Schema.decodeEffect(channelChallengeRequestSchema)({
    channel,
    purpose: "login",
  }).pipe(Effect.mapError(() => loginHttpError(400)));
  const challenge = yield* requestJson(
    "start",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent),
    },
    channelChallengeSchema
  );
  if (challenge.channel !== channel) return yield* invalidChannelChallenge(200);
  return challenge;
});

export const checkChannelLogin = Effect.fn("channelLogin.status")(function* (
  id: string
) {
  const input = yield* Schema.decodeEffect(channelChallengeIdSchema)({
    id,
  }).pipe(Effect.mapError(() => loginHttpError(400)));
  return yield* requestJson(
    `status?id=${encodeURIComponent(input.id)}`,
    { method: "GET" },
    channelChallengeStatusSchema
  );
});

export const completeChannelLogin = Effect.fn("channelLogin.complete")(
  function* (id: string) {
    const input = yield* Schema.decodeEffect(channelChallengeIdSchema)({
      id,
    }).pipe(Effect.mapError(() => loginHttpError(400)));
    yield* requestJson(
      "complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      channelChallengeCompletionSchema
    );
  }
);
