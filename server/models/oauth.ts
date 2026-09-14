// Protocol adapters informed by pi's MIT-licensed device OAuth flows; see THIRD_PARTY_NOTICES.md.
import { DateTime, Effect, Option, Schema } from "effect";
import type { ModelProviderSchema } from "../../shared/models/catalog";
import { ModelConnectionError } from "../../shared/models/catalog";

const clients = {
  chatgpt: "app_EMoamEEZ73f0CkXaXp7hrann",
  grok: "b1a00492-073a-47ea-816f-4c329264a828",
} as const;
const tokenUrls = {
  chatgpt: "https://auth.openai.com/oauth/token",
  grok: "https://auth.x.ai/oauth2/token",
} as const;
const secret = Schema.NonEmptyString.check(Schema.isMaxLength(24_000));
export const ModelTokensSchema = Schema.Struct({
  accessToken: secret,
  refreshToken: secret,
  expiresAt: Schema.Number,
  accountId: Schema.optional(Schema.String),
});
export const DevicePayloadSchema = Schema.Struct({
  deviceCode: secret,
  userCode: secret,
});
const TokenResponse = Schema.Struct({
  access_token: secret,
  refresh_token: Schema.optional(secret),
  expires_in: Schema.Number.check(Schema.isGreaterThan(0)),
});
const DeviceResponse = Schema.Struct({
  device_code: secret,
  user_code: secret,
  verification_uri: Schema.String,
  interval: Schema.optional(Schema.Number),
  expires_in: Schema.Number,
});
const CodexDeviceResponse = Schema.Struct({
  device_auth_id: secret,
  user_code: secret,
  interval: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
});
const ProviderError = Schema.Struct({ error: Schema.String });

const oauthRequest = Effect.fn("model.oauth.request")(function* (
  url: string,
  body: URLSearchParams | string
) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "content-type": Schema.is(Schema.String)(body)
            ? "application/json"
            : "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      }),
    catch: () => new ModelConnectionError({ reason: "unavailable" }),
  }).pipe(Effect.timeout("20 seconds"));
  const data: unknown = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () => new ModelConnectionError({ reason: "invalid_response" }),
  });
  const json = yield* Schema.decodeUnknownEffect(Schema.Json)(data).pipe(
    Effect.mapError(
      () => new ModelConnectionError({ reason: "invalid_response" })
    )
  );
  return { status: response.status, data: json };
});

const parseTokens = Effect.fn("model.oauth.tokens")(function* (
  provider: typeof ModelProviderSchema.Type,
  data: Schema.Json,
  previousRefresh?: string
) {
  const token = yield* Schema.decodeUnknownEffect(TokenResponse)(data).pipe(
    Effect.mapError(
      () => new ModelConnectionError({ reason: "invalid_response" })
    )
  );
  const refreshToken = token.refresh_token ?? previousRefresh;
  if (!refreshToken)
    return yield* new ModelConnectionError({ reason: "invalid_response" });
  const now = yield* DateTime.nowAsDate;
  let accountId: string | undefined;
  if (provider === "chatgpt") {
    const payload = token.access_token.split(".")[1];
    if (!payload)
      return yield* new ModelConnectionError({ reason: "invalid_response" });
    // Routing metadata only: this claim is never used to authenticate a Zoen user.
    const identity = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(
        Schema.Struct({
          "https://api.openai.com/auth": Schema.Struct({
            chatgpt_account_id: Schema.NonEmptyString,
          }),
        })
      )
    )(Buffer.from(payload, "base64url").toString("utf8")).pipe(
      Effect.mapError(
        () => new ModelConnectionError({ reason: "invalid_response" })
      )
    );
    accountId = identity["https://api.openai.com/auth"].chatgpt_account_id;
  }
  return {
    accessToken: token.access_token,
    refreshToken,
    expiresAt: now.getTime() + token.expires_in * 1000,
    accountId,
  };
});

export const beginModelOAuth = Effect.fn("model.oauth.begin")(function* (
  provider: typeof ModelProviderSchema.Type
) {
  if (provider === "chatgpt") {
    const response = yield* oauthRequest(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      JSON.stringify({ client_id: clients.chatgpt })
    );
    if (response.status !== 200)
      return yield* new ModelConnectionError({ reason: "unavailable" });
    const value = yield* Schema.decodeUnknownEffect(CodexDeviceResponse)(
      response.data
    );
    const seconds = Number(value.interval ?? 5);
    return {
      deviceCode: value.device_auth_id,
      userCode: value.user_code,
      verificationUri: "https://auth.openai.com/codex/device",
      interval: Number.isFinite(seconds)
        ? Math.max(5, Math.min(seconds, 60))
        : 5,
      expiresIn: 900,
    };
  }
  const response = yield* oauthRequest(
    "https://auth.x.ai/oauth2/device/code",
    new URLSearchParams({
      client_id: clients.grok,
      scope: "openid profile email offline_access grok-cli:access api:access",
      referrer: "zoen",
    })
  );
  if (response.status !== 200)
    return yield* new ModelConnectionError({ reason: "unavailable" });
  const value = yield* Schema.decodeUnknownEffect(DeviceResponse)(
    response.data
  );
  const url = yield* Effect.try({
    try: () => new URL(value.verification_uri),
    catch: () => new ModelConnectionError({ reason: "invalid_response" }),
  });
  if (
    url.protocol !== "https:" ||
    !["auth.x.ai", "accounts.x.ai", "grok.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    return yield* new ModelConnectionError({ reason: "invalid_response" });
  return {
    deviceCode: value.device_code,
    userCode: value.user_code,
    verificationUri: url.href,
    interval: Math.max(5, Math.min(value.interval ?? 5, 60)),
    expiresIn: Math.max(30, Math.min(value.expires_in, 900)),
  };
});

export const pollModelOAuth = Effect.fn("model.oauth.poll")(function* (
  provider: typeof ModelProviderSchema.Type,
  payload: typeof DevicePayloadSchema.Type
) {
  const response =
    provider === "chatgpt"
      ? yield* oauthRequest(
          "https://auth.openai.com/api/accounts/deviceauth/token",
          JSON.stringify({
            device_auth_id: payload.deviceCode,
            user_code: payload.userCode,
          })
        )
      : yield* oauthRequest(
          tokenUrls.grok,
          new URLSearchParams({
            client_id: clients.grok,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: payload.deviceCode,
          })
        );
  if (response.status !== 200) {
    if (provider === "chatgpt" && [403, 404].includes(response.status))
      return { status: "pending" } as const;
    const error = Schema.decodeUnknownOption(ProviderError)(response.data);
    if (
      Option.isSome(error) &&
      [
        "authorization_pending",
        "deviceauth_authorization_pending",
        "slow_down",
      ].includes(error.value.error)
    )
      return {
        status: error.value.error === "slow_down" ? "slow_down" : "pending",
      } as const;
    return yield* new ModelConnectionError({
      reason: response.status === 429 ? "rate_limited" : "denied",
    });
  }
  let data = response.data;
  if (provider === "chatgpt") {
    const code = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ authorization_code: secret, code_verifier: secret })
    )(data);
    const exchanged = yield* oauthRequest(
      tokenUrls.chatgpt,
      new URLSearchParams({
        client_id: clients.chatgpt,
        grant_type: "authorization_code",
        code: code.authorization_code,
        code_verifier: code.code_verifier,
        redirect_uri: "https://auth.openai.com/deviceauth/callback",
      })
    );
    if (exchanged.status !== 200)
      return yield* new ModelConnectionError({ reason: "denied" });
    data = exchanged.data;
  }
  return {
    status: "connected",
    tokens: yield* parseTokens(provider, data),
  } as const;
});

export const refreshModelOAuth = Effect.fn("model.oauth.refresh")(function* (
  provider: typeof ModelProviderSchema.Type,
  tokens: typeof ModelTokensSchema.Type
) {
  const response = yield* oauthRequest(
    tokenUrls[provider],
    new URLSearchParams({
      client_id: clients[provider],
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    })
  );
  if (response.status !== 200)
    return yield* new ModelConnectionError({ reason: "reconnect" });
  return yield* parseTokens(provider, response.data, tokens.refreshToken);
});
