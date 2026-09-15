import { Effect, Redacted, Schema } from "effect";
import { env } from "@shared/environment";

export class WhatsAppBridgeUnavailable extends Schema.TaggedError<WhatsAppBridgeUnavailable>()(
  "WhatsAppBridgeUnavailable",
  { reason: Schema.String }
) {}

const loginStepSchema = Schema.Struct({
  login_id: Schema.String,
  type: Schema.optional(Schema.String),
  step_id: Schema.optional(Schema.String),
  display_and_wait: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String),
      data: Schema.optional(Schema.String),
    })
  ),
});
const whoamiSchema = Schema.Struct({
  logins: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.optional(Schema.String),
        profile: Schema.optional(
          Schema.Struct({
            phone: Schema.optional(Schema.String),
            name: Schema.optional(Schema.String),
          })
        ),
      })
    )
  ),
});
const eventSchema = Schema.Struct({ event_id: Schema.String });

const whatsappBridgeConfiguration = Effect.gen(function* () {
  if (!env.ZOEN_WHATSAPP_BRIDGE_URL || !env.ZOEN_WHATSAPP_PROVISIONING_SECRET)
    return yield* new WhatsAppBridgeUnavailable({ reason: "unconfigured" });
  return {
    url: env.ZOEN_WHATSAPP_BRIDGE_URL,
    secret: env.ZOEN_WHATSAPP_PROVISIONING_SECRET,
    asToken: env.ZOEN_WHATSAPP_AS_TOKEN,
    matrixUrl: env.ZOEN_MATRIX_URL,
    serverName: env.ZOEN_MATRIX_SERVER_NAME,
  };
});

const provisionRequest = Effect.fn("whatsapp.provisionRequest")(function* (
  method: "GET" | "POST",
  path: string,
  userId: string,
  body?: typeof Schema.Json.Type
) {
  const config = yield* whatsappBridgeConfiguration;
  const url = new URL(path, config.url);
  url.searchParams.set("user_id", userId);
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const options: RequestInit = {
        method,
        signal,
        redirect: "error",
        headers: {
          authorization: `Bearer ${Redacted.value(config.secret)}`,
          "content-type": "application/json",
        },
      };
      if (body !== undefined && method !== "GET")
        options.body = JSON.stringify(body);
      const response = await fetch(url, options);
      if (!response.ok)
        throw new WhatsAppBridgeUnavailable({ reason: "unreachable" });
      const text = await response.text();
      if (!text) return {};
      return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));
    },
    catch: (error) =>
      error instanceof WhatsAppBridgeUnavailable
        ? error
        : new WhatsAppBridgeUnavailable({ reason: "unreachable" }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () =>
        Effect.fail(new WhatsAppBridgeUnavailable({ reason: "unreachable" })),
    })
  );
});

/** Ready is required before any pairing or send. Tokens never enter URLs or logs. */
export const assertWhatsAppBridgeReady = Effect.fn(
  "whatsapp.assertBridgeReady"
)(function* () {
  const config = yield* whatsappBridgeConfiguration;
  yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(new URL("/_matrix/mau/ready", config.url), {
        method: "GET",
        signal,
        redirect: "error",
        headers: {
          authorization: `Bearer ${Redacted.value(config.secret)}`,
        },
      });
      if (!response.ok)
        throw new WhatsAppBridgeUnavailable({ reason: "unreachable" });
    },
    catch: (error) =>
      error instanceof WhatsAppBridgeUnavailable
        ? error
        : new WhatsAppBridgeUnavailable({ reason: "unreachable" }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: "8 seconds",
      orElse: () =>
        Effect.fail(new WhatsAppBridgeUnavailable({ reason: "unreachable" })),
    })
  );
});

export const startWhatsAppLogin = Effect.fn("whatsapp.startLogin")(function* (
  matrixUserId: string
) {
  yield* assertWhatsAppBridgeReady();
  const raw = yield* provisionRequest(
    "POST",
    "/_matrix/provision/v3/login/start/qr",
    matrixUserId
  );
  const step = yield* Schema.decodeUnknownEffect(loginStepSchema, {
    onExcessProperty: "ignore",
  })(raw);
  return {
    loginId: step.login_id,
    qr: step.display_and_wait?.data ?? null,
  };
});

export const whoamiWhatsApp = Effect.fn("whatsapp.whoami")(function* (
  matrixUserId: string
) {
  yield* assertWhatsAppBridgeReady();
  const raw = yield* provisionRequest(
    "GET",
    "/_matrix/provision/v3/whoami",
    matrixUserId
  );
  const whoami = yield* Schema.decodeUnknownEffect(whoamiSchema, {
    onExcessProperty: "ignore",
  })(raw);
  const login = whoami.logins?.[0];
  return {
    loggedIn: Boolean(login),
    loginId: login?.id ?? null,
    remoteUserId: login?.id ?? login?.profile?.phone ?? login?.name ?? null,
  };
});

export const logoutWhatsApp = Effect.fn("whatsapp.logout")(function* (
  matrixUserId: string,
  loginId?: string | null
) {
  yield* assertWhatsAppBridgeReady();
  yield* provisionRequest(
    "POST",
    `/_matrix/provision/v3/logout/${encodeURIComponent(loginId ?? "all")}`,
    matrixUserId
  );
  return { loggedOut: true as const };
});

/** Portal send uses the WhatsApp appservice token as the puppet. Never delivered without it. */
export const sendWhatsAppPortalMessage = Effect.fn(
  "whatsapp.sendPortalMessage"
)(function* (input: {
  roomId: string;
  body: string;
  txnId: string;
  puppetUserId: string;
}) {
  const config = yield* whatsappBridgeConfiguration;
  const asToken = config.asToken;
  const matrixUrl = config.matrixUrl;
  if (!asToken || !matrixUrl)
    return yield* new WhatsAppBridgeUnavailable({ reason: "unconfigured" });
  const url = new URL(
    `/_matrix/client/v3/rooms/${encodeURIComponent(input.roomId)}/send/m.room.message/${encodeURIComponent(input.txnId)}`,
    matrixUrl
  );
  url.searchParams.set("user_id", input.puppetUserId);
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        method: "PUT",
        signal,
        redirect: "error",
        headers: {
          authorization: `Bearer ${Redacted.value(asToken)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ msgtype: "m.text", body: input.body }),
      });
      if (!response.ok)
        throw new WhatsAppBridgeUnavailable({ reason: "unreachable" });
      return Schema.decodeUnknownSync(eventSchema, {
        onExcessProperty: "ignore",
      })(await response.json());
    },
    catch: (error) =>
      error instanceof WhatsAppBridgeUnavailable
        ? error
        : new WhatsAppBridgeUnavailable({ reason: "unreachable" }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () =>
        Effect.fail(new WhatsAppBridgeUnavailable({ reason: "unreachable" })),
    })
  );
});
