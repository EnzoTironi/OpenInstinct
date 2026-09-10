import { randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  getAuthoritativeSessionFromCtx,
  originCheckMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { Config, Effect, Schema } from "effect";
import {
  channelChallengeIdSchema,
  channelChallengeRequestSchema,
  channelChallengeSchema,
  channelConversationEntrySchema,
  deviceBindingSchema,
  deviceRequestSchema,
  deviceBoundSchema,
  type channelProviderSchema,
} from "../../shared/identity/channel-auth.ts";
import { ChannelAccountError, ChannelAccounts } from "../accounts/index.ts";
import { NativeDeviceAuth } from "../accounts/device";

type EndpointContext = Parameters<typeof setSessionCookie>[0];
const InstallationId = Schema.NonEmptyString.check(Schema.isTrimmed());
const TelegramCapability = Schema.Struct({
  installationId: InstallationId,
  username: Schema.String.check(
    Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]{4,31}$/u)
  ),
});
const KapsoCapability = Schema.Struct({
  installationId: InstallationId,
  phoneNumber: Schema.String.check(Schema.isPattern(/^\+[1-9][0-9]{6,14}$/u)),
});
const BrowserSecret = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)
);
export type ChannelAuthRunEffect = <A, E>(
  program: Effect.Effect<A, E, ChannelAccounts | NativeDeviceAuth>
) => Promise<A>;
class ChannelAuthError extends Schema.TaggedError<ChannelAuthError>()(
  "ChannelAuthError",
  {
    reason: Schema.Literals([
      "unavailable",
      "unauthorized",
      "invalid",
      "internal",
    ]),
  }
) {}
const sdk = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: () => new ChannelAuthError({ reason: "internal" }),
  });
const browserCookie = (ctx: EndpointContext, id: string) => {
  const cookie = ctx.context.createAuthCookie(`channel_challenge_${id}`, {
    maxAge: 600,
  });
  return {
    name: cookie.name,
    attributes: {
      ...cookie.attributes,
      domain: undefined,
      httpOnly: true,
      sameSite: "lax" as const,
      path: `${new URL(ctx.context.baseURL).pathname.replace(/\/$/u, "")}/channel-auth`,
      maxAge: 600,
    },
  };
};
const readBrowserSecret = Effect.fn("ChannelAuth.readBrowserSecret")(function* (
  ctx: EndpointContext,
  id: string
) {
  const cookie = browserCookie(ctx, id);
  const value = yield* sdk(() =>
    ctx.getSignedCookie(cookie.name, ctx.context.secret)
  );
  return yield* Schema.decodeUnknownEffect(BrowserSecret)(value).pipe(
    Effect.mapError(() => new ChannelAuthError({ reason: "invalid" }))
  );
});
const channelDestination = Effect.fn("ChannelAuth.channelDestination")(
  function* (channel: typeof channelProviderSchema.Type) {
    if (channel === "telegram") {
      const values = yield* Config.all({
        installationId: Config.string("TELEGRAM_BOT_ID"),
        username: Config.string("TELEGRAM_BOT_USERNAME"),
      });
      const capability =
        yield* Schema.decodeUnknownEffect(TelegramCapability)(values);
      return {
        installationId: capability.installationId,
        url: `https://t.me/${capability.username}`,
        parameter: "start",
      };
    }
    const values = yield* Config.all({
      installationId: Config.string("KAPSO_PHONE_NUMBER_ID"),
      phoneNumber: Config.string("KAPSO_PHONE_NUMBER"),
    });
    const capability =
      yield* Schema.decodeUnknownEffect(KapsoCapability)(values);
    return {
      installationId: capability.installationId,
      url: `https://wa.me/${capability.phoneNumber.slice(1)}`,
      parameter: "text",
    };
  },
  Effect.mapError(() => new ChannelAuthError({ reason: "unavailable" }))
);
const readLinkSession = Effect.fn("ChannelAuth.readLinkSession")(function* (
  ctx: EndpointContext
) {
  const current = yield* sdk(() => getAuthoritativeSessionFromCtx(ctx));
  if (!current) return yield* new ChannelAuthError({ reason: "unauthorized" });
  const link = { userId: current.user.id, sessionId: current.session.id };
  const accounts = yield* ChannelAccounts;
  yield* accounts.requireFreshSession(link);
  return link;
});
const publicError = (error: ChannelAuthError | ChannelAccountError) => {
  if (error.reason === "unavailable")
    return new APIError("SERVICE_UNAVAILABLE", {
      message: "Channel unavailable",
    });
  if (error.reason === "account_conflict")
    return new APIError("CONFLICT", {
      message:
        "This messenger is already associated with another account. Accounts are not merged.",
    });
  if (error.reason === "internal")
    return new APIError("INTERNAL_SERVER_ERROR", {
      message: "Unable to complete channel authentication",
    });
  if (error.reason === "unauthorized" || error.reason === "session_invalid")
    return new APIError("UNAUTHORIZED", {
      message: "A recent authenticated session is required",
    });
  return new APIError("BAD_REQUEST", { message: "Invalid channel challenge" });
};
/** The sole Promise bridge; domain and SDK operations execute in the supplied runtime. */
const execute = async <A, E>(
  runEffect: ChannelAuthRunEffect,
  program: Effect.Effect<A, E, ChannelAccounts | NativeDeviceAuth>
) => {
  const result = await runEffect(
    program.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({
          ok: false as const,
          error:
            error instanceof ChannelAccountError ||
            error instanceof ChannelAuthError
              ? publicError(error)
              : new APIError("INTERNAL_SERVER_ERROR", {
                  message: "Unable to complete channel authentication",
                }),
        }),
      })
    )
  ).catch(() => {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message: "Unable to complete channel authentication",
    });
  });
  if (!result.ok) throw result.error;
  return result.value;
};

export const channelAuthPlugin = (runEffect: ChannelAuthRunEffect) =>
  ({
    id: "channel-auth",
    endpoints: {
      startChannelAuth: createAuthEndpoint(
        "/channel-auth/start",
        {
          method: "POST",
          body: Schema.toStandardSchemaV1(channelChallengeRequestSchema),
          use: [originCheckMiddleware, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              runEffect,
              Effect.gen(function* () {
                const destination = yield* channelDestination(ctx.body.channel);
                const current =
                  ctx.body.purpose === "link"
                    ? yield* readLinkSession(ctx)
                    : null;
                if (ctx.body.channel === "kapso") {
                  ctx.setHeader("Cache-Control", "no-store");
                  return yield* Schema.decodeUnknownEffect(
                    channelConversationEntrySchema
                  )({
                    channel: "kapso",
                    conversationUrl: `${destination.url}?text=${encodeURIComponent(ctx.body.purpose === "link" ? "quero vincular meu WhatsApp à conta aberta no navegador" : "quero abrir minha conta no navegador")}`,
                  });
                }
                const accounts = yield* ChannelAccounts;
                const browserSecret = yield* Effect.sync(() =>
                  randomBytes(32).toString("base64url")
                );
                const challenge = yield* accounts.issueChallenge(
                  current
                    ? {
                        purpose: "link" as const,
                        channel: ctx.body.channel,
                        installationId: destination.installationId,
                        browserSecret,
                        userId: current.userId,
                        sessionId: current.sessionId,
                      }
                    : {
                        purpose: "login" as const,
                        channel: ctx.body.channel,
                        installationId: destination.installationId,
                        browserSecret,
                      }
                );
                const message = challenge.token;
                const response = yield* Schema.decodeUnknownEffect(
                  channelChallengeSchema
                )({
                  id: challenge.challengeId,
                  channel: ctx.body.channel,
                  deepLink: `${destination.url}?${destination.parameter}=${encodeURIComponent(message)}`,
                  expiresAt: challenge.expiresAt,
                });
                const cookie = browserCookie(ctx, challenge.challengeId);
                yield* sdk(() =>
                  ctx.setSignedCookie(
                    cookie.name,
                    browserSecret,
                    ctx.context.secret,
                    cookie.attributes
                  )
                );
                ctx.setHeader("Cache-Control", "no-store");
                return response;
              })
            )
          )
      ),
      bindNativeDevice: createAuthEndpoint(
        "/channel-auth/device-bind",
        {
          method: "POST",
          body: Schema.toStandardSchemaV1(deviceBindingSchema, {
            parseOptions: { onExcessProperty: "error" },
          }),
          use: [originCheckMiddleware, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              runEffect,
              Effect.gen(function* () {
                const cookie = browserCookie(ctx, ctx.body.id);
                const previous = yield* sdk(() =>
                  ctx.getSignedCookie(cookie.name, ctx.context.secret)
                );
                const browserSecret = Schema.is(BrowserSecret)(previous)
                  ? previous
                  : randomBytes(32).toString("base64url");
                const devices = yield* NativeDeviceAuth;
                const input = { ...ctx.body, browserSecret };
                const bound =
                  ctx.body.purpose === "link"
                    ? yield* devices.bind({
                        ...input,
                        link: yield* readLinkSession(ctx),
                      })
                    : yield* devices.bind(input);
                yield* sdk(() =>
                  ctx.setSignedCookie(
                    cookie.name,
                    browserSecret,
                    ctx.context.secret,
                    cookie.attributes
                  )
                );
                ctx.setHeader("Cache-Control", "no-store");
                return yield* Schema.decodeUnknownEffect(deviceBoundSchema)({
                  id: bound.id,
                  purpose: bound.purpose,
                  channel: bound.channel,
                  expiresAt: bound.expiresAt,
                });
              })
            )
          )
      ),
      resumeNativeDevice: createAuthEndpoint(
        "/channel-auth/device",
        {
          method: "GET",
          query: Schema.toStandardSchemaV1(deviceRequestSchema),
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              runEffect,
              Effect.gen(function* () {
                const browserSecret = yield* readBrowserSecret(
                  ctx,
                  ctx.query.id
                );
                const devices = yield* NativeDeviceAuth;
                const input = { ...ctx.query, browserSecret };
                const bound =
                  ctx.query.purpose === "link"
                    ? yield* devices.resume({
                        ...input,
                        link: yield* readLinkSession(ctx),
                      })
                    : yield* devices.resume(input);
                ctx.setHeader("Cache-Control", "no-store");
                return {
                  id: bound.id,
                  purpose: bound.purpose,
                  channel: bound.channel,
                  expiresAt: bound.expiresAt,
                };
              })
            )
          )
      ),
      channelAuthStatus: createAuthEndpoint(
        "/channel-auth/status",
        {
          method: "GET",
          query: Schema.toStandardSchemaV1(channelChallengeIdSchema),
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              runEffect,
              Effect.gen(function* () {
                const browserSecret = yield* readBrowserSecret(
                  ctx,
                  ctx.query.id
                );
                const accounts = yield* ChannelAccounts;
                const status = yield* accounts.getChallengeStatus({
                  challengeId: ctx.query.id,
                  browserSecret,
                });
                ctx.setHeader("Cache-Control", "no-store");
                return status;
              })
            )
          )
      ),
      completeChannelAuth: createAuthEndpoint(
        "/channel-auth/complete",
        {
          method: "POST",
          body: Schema.toStandardSchemaV1(channelChallengeIdSchema),
          use: [originCheckMiddleware, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              runEffect,
              Effect.gen(function* () {
                const browserSecret = yield* readBrowserSecret(
                  ctx,
                  ctx.body.id
                );
                const current = yield* sdk(() =>
                  getAuthoritativeSessionFromCtx(ctx)
                );
                const accounts = yield* ChannelAccounts;
                const consumeInput = {
                  challengeId: ctx.body.id,
                  browserSecret,
                };
                const consumed = yield* accounts.consumeChallenge(
                  current
                    ? { ...consumeInput, currentSessionId: current.session.id }
                    : consumeInput
                );
                if (consumed.purpose === "login") {
                  const issued = yield* accounts.withLoginSession(
                    consumed,
                    Effect.gen(function* () {
                      const user = yield* sdk(() =>
                        ctx.context.internalAdapter.findUserById(
                          consumed.userId
                        )
                      );
                      if (!user)
                        return yield* new ChannelAuthError({
                          reason: "invalid",
                        });
                      const session = yield* sdk(() =>
                        ctx.context.internalAdapter.createSession(user.id)
                      );
                      return { session, user };
                    })
                  );
                  yield* sdk(() => setSessionCookie(ctx, issued));
                }
                const cookie = browserCookie(ctx, ctx.body.id);
                ctx.setCookie(cookie.name, "", {
                  ...cookie.attributes,
                  maxAge: 0,
                });
                ctx.setHeader("Cache-Control", "no-store");
                return { ok: true as const };
              })
            )
          )
      ),
    },
  }) satisfies BetterAuthPlugin;
