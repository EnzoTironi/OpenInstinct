import { Action } from "alchemy/Action";
import { Config, Effect, Redacted, Schedule, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

interface WebhookDeployment {
  baseUrl: string;
  legacyBaseUrl: string;
  machine: string;
  release: string;
  credentialVersion: string;
}

const KapsoWebhook = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  active: Schema.Boolean,
  secret_key: Schema.String,
  events: Schema.Array(Schema.String),
});
const kapsoList = Schema.Struct({ data: Schema.Array(KapsoWebhook) });
const telegramInfo = Schema.Struct({
  ok: Schema.Literal(true),
  result: Schema.Struct({ url: Schema.String }),
});

// Provider errors may contain credential-bearing URLs and headers. Keep them out
// of Alchemy logs/state; the operation name is enough to locate the failing step.
const requestJson = <S extends Schema.ConstraintDecoder<unknown>>(
  operation: string,
  request: HttpClientRequest.HttpClientRequest,
  schema: S
) =>
  HttpClient.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.timeout("15 seconds"),
    Effect.mapError(() => new Error(`${operation} failed`))
  );

const reconcileTelegram = Effect.fn("reconcileTelegram")(function* (
  input: WebhookDeployment
) {
  const token = yield* Config.redacted("TELEGRAM_BOT_TOKEN");
  const secret = yield* Config.redacted("TELEGRAM_WEBHOOK_SECRET");
  const api = `https://api.telegram.org/bot${Redacted.value(token)}`;
  const url = `${input.baseUrl}/api/channels/telegram`;
  const inspect = requestJson(
    "Telegram webhook inspection",
    HttpClientRequest.get(`${api}/getWebhookInfo`),
    telegramInfo
  );
  const before = yield* inspect;
  if (
    !["", url, `${input.legacyBaseUrl}/api/channels/telegram`].includes(
      before.result.url
    )
  )
    return yield* Effect.fail(
      new Error("Telegram webhook belongs to another installation")
    );
  const request = yield* HttpClientRequest.post(`${api}/setWebhook`).pipe(
    HttpClientRequest.bodyJson({
      url,
      secret_token: Redacted.value(secret),
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query", "my_chat_member"],
    })
  );
  yield* requestJson(
    "Telegram webhook update",
    request,
    Schema.Struct({ ok: Schema.Literal(true), result: Schema.Literal(true) })
  );
  if ((yield* inspect).result.url !== url)
    return yield* Effect.fail(
      new Error("Telegram webhook readback does not match deployment")
    );
  return url;
});

const reconcileKapso = Effect.fn("reconcileKapso")(function* (
  input: WebhookDeployment
) {
  const phone = yield* Config.string("KAPSO_PHONE_NUMBER_ID");
  const apiKey = yield* Config.redacted("KAPSO_API_KEY");
  const secret = yield* Config.redacted("KAPSO_WEBHOOK_SECRET");
  const api = `https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/${encodeURIComponent(phone)}/webhooks`;
  const headers = { "X-API-Key": Redacted.value(apiKey) };
  const url = `${input.baseUrl}/api/channels/kapso`;
  const inspect = requestJson(
    "WhatsApp webhook inspection",
    HttpClientRequest.get(`${api}?kind=kapso&per_page=100`, { headers }),
    kapsoList
  );
  const before = (yield* inspect).data;
  const owned = before.filter((hook) =>
    [url, `${input.legacyBaseUrl}/api/channels/kapso`].includes(hook.url)
  );
  if (owned.length > 1 || (owned.length === 0 && before.length > 0))
    return yield* Effect.fail(
      new Error("WhatsApp webhook ownership is ambiguous")
    );
  const existing = owned.at(0);
  const attributes = {
    url,
    secret_key: Redacted.value(secret),
    active: true,
    events: ["whatsapp.message.received"],
    payload_version: "v2",
    buffer_enabled: false,
  };
  const request = yield* (
    existing
      ? HttpClientRequest.patch(`${api}/${encodeURIComponent(existing.id)}`, {
          headers,
        })
      : HttpClientRequest.post(api, { headers })
  ).pipe(
    HttpClientRequest.bodyJson({
      whatsapp_webhook: existing
        ? attributes
        : { ...attributes, kind: "kapso" },
    })
  );
  yield* requestJson(
    "WhatsApp webhook update",
    request,
    Schema.Struct({ data: KapsoWebhook })
  );
  const after = (yield* inspect).data.filter((hook) => hook.url === url);
  if (
    after.length !== 1 ||
    !after[0]?.active ||
    after[0].secret_key !== Redacted.value(secret) ||
    !after[0].events.includes("whatsapp.message.received")
  )
    return yield* Effect.fail(
      new Error("WhatsApp webhook readback does not match deployment")
    );
  return url;
});

export const reconcileChannelWebhooks = Effect.fn("reconcileChannelWebhooks")(
  function* (input: WebhookDeployment) {
    const origin = new URL(input.baseUrl);
    if (origin.protocol !== "https:" || origin.origin !== input.baseUrl)
      return yield* Effect.fail(
        new Error("Webhooks require a public HTTPS origin")
      );
    yield* requestJson(
      "Web readiness",
      HttpClientRequest.get(`${input.baseUrl}/eve/v1/health`),
      Schema.Struct({
        ok: Schema.Literal(true),
        status: Schema.Literal("ready"),
      })
    ).pipe(Effect.retry({ times: 12, schedule: Schedule.spaced("5 seconds") }));
    const telegram = yield* reconcileTelegram(input);
    const whatsapp = yield* reconcileKapso(input);
    return { telegram, whatsapp, release: input.release };
  }
);

export const ReconcileChannelWebhooks = Action(
  "Zoen.ReconcileChannelWebhooks",
  (input: WebhookDeployment) =>
    reconcileChannelWebhooks(input).pipe(Effect.provide(FetchHttpClient.layer))
);
