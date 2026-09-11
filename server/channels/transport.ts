import { PgClient } from "@effect/sql-pg";
import { Config, Context, Effect, Layer, Schema } from "effect";

import { accessScopeForUser } from "../../shared/identity/access-scope";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { ChannelAccounts, IdentitySchema, type Identity } from "../accounts";
import {
  IdentityId,
  Messaging,
  MessagePayloadSchema,
  PayloadConflict,
  type MessageClaim,
} from "../messaging";
import { InputDeliveryReferenceSchema } from "../messaging/model";
import { ProviderReferenceSchema } from "./inbound";
import { Kapso, KapsoInstallationSchema } from "./kapso";
import { Telegram, TelegramInstallationSchema } from "./telegram";

/** Outbox drain terminal states — mutually exclusive; no bag of optional counters. */
export type DrainOutboxResult =
  | {
      readonly state: "idle";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "sent";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "failed";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "deferred";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "uncertain";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "blocked";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "limit";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    };

export class ChannelTransportError extends Schema.TaggedError<ChannelTransportError>()(
  "ChannelTransportError",
  {
    reason: Schema.Literals([
      "invalid_input",
      "identity_inactive",
      "channel_mismatch",
      "installation_mismatch",
      "configuration",
      "unsupported_payload",
    ]),
  }
) {}

const invalidInput = () =>
  new ChannelTransportError({ reason: "invalid_input" });

const textSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(16_384),
  Schema.makeFilter((text) => text.isWellFormed() && text.trim().length > 0)
);

const decodeEffect_textSchema = Schema.decodeUnknownEffect(textSchema);

const enqueueInput = Schema.Struct({
  identityId: IdentityId,
  deliveryKey: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(254),
    Schema.isTrimmed()
  ),
  text: textSchema,
  inputRequest: Schema.optionalKey(InputDeliveryReferenceSchema),
  replyToMessageId: Schema.optionalKey(ProviderReferenceSchema),
});
const decodeIdentityId = Schema.decodeUnknownEffect(IdentityId);
const decodeIdentitySchema = Schema.decodeUnknownEffect(IdentitySchema);
const decodeChannelProviderSchema = Schema.decodeUnknownEffect(channelProviderSchema);
const decodeSchema_Array_IdentitySchema = Schema.decodeUnknownEffect(Schema.Array(IdentitySchema));
const decodeEnqueueInput = Schema.decodeUnknownEffect(enqueueInput, {
      onExcessProperty: "error",
    });
const decodeMessagePayloadSchema = Schema.decodeUnknownEffect(MessagePayloadSchema);
const decodeEnqueueInput2 = Schema.decodeUnknownEffect(enqueueInput, {
        onExcessProperty: "error",
      });
const decodeSchema_String_check_Schema_isPattern_task_report_0 = Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^task-report:[0-9a-f]{64}$/u)));
const decodeInputDeliveryReferenceSchema = Schema.decodeUnknownEffect(InputDeliveryReferenceSchema);
const decodeSchema_Array_Schema_Struct_key_Schema_String_paylo = Schema.decodeUnknownEffect(Schema.Array(
          Schema.Struct({
            key: Schema.String,
            payload: MessagePayloadSchema,
            status: Schema.String,
            sentAtMs: Schema.NullOr(Schema.Finite),
            providerMessageId: Schema.NullOr(Schema.String),
          })
        ));

const candidateInput = Schema.Struct({
  channel: channelProviderSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 25 })),
});

const decodeEffect_candidateInput = Schema.decodeUnknownEffect(candidateInput);

/** Keeps UTF-16 surrogate pairs intact without changing the original text. */
export const splitChannelText = Effect.fn("ChannelTransport.splitChannelText")(
  function* (text: string) {
    const value = yield* decodeEffect_textSchema(text).pipe(
      Effect.mapError(invalidInput)
    );

    const chunks: string[] = [];

    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + 4000, value.length);
      const last = value.charCodeAt(end - 1);

      if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
      chunks.push(value.slice(offset, end));
      offset = end;
    }

    return chunks;
  }
);

const makeTransport = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const accounts = yield* ChannelAccounts;
  const messaging = yield* Messaging;
  const telegram = yield* Telegram;
  const kapso = yield* Kapso;

  const identityColumns = sql`i.id, i.user_id AS "userId", i.channel,
    i.installation_id AS "installationId", i.sender_id AS "senderId"`;

  const findIdentity = Effect.fn("ChannelTransport.findIdentity")(function* (
    identityId: string
  ) {
    const id = yield* decodeIdentityId(identityId).pipe(
      Effect.mapError(invalidInput)
    );

    const rows =
      yield* sql`SELECT ${identityColumns} FROM channel_identity i WHERE i.id = ${id}`;

    if (!rows[0])
      return yield* new ChannelTransportError({ reason: "identity_inactive" });

    return yield* decodeIdentitySchema(rows[0]);
  });

  const activeIdentity = Effect.fn("ChannelTransport.activeIdentity")(
    function* (identityId: string, expectedChannel: Identity["channel"]) {
      const channel = yield* decodeChannelProviderSchema(
        expectedChannel
      ).pipe(Effect.mapError(invalidInput));

      const identity = yield* findIdentity(identityId);

      if (identity.channel !== channel)
        return yield* new ChannelTransportError({ reason: "channel_mismatch" });

      const active = yield* accounts
        .getActiveIdentity(identity)
        .pipe(
          Effect.catchTag(
            "ChannelAccountError",
            () => new ChannelTransportError({ reason: "identity_inactive" })
          )
        );

      if (active.id !== identity.id || active.userId !== identity.userId)
        return yield* new ChannelTransportError({
          reason: "identity_inactive",
        });
      const scope = accessScopeForUser(`better-auth:${active.userId}`);

      const membership = yield* sql`SELECT 1 FROM workspace_memberships
        WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`;

      if (membership.length !== 1)
        return yield* new ChannelTransportError({
          reason: "identity_inactive",
        });

      return active;
    }
  );

  const candidates = Effect.fn("ChannelTransport.candidates")(function* (
    lane: "inbox" | "outbox",
    channel: Identity["channel"],
    limit: number
  ) {
    const input = yield* decodeEffect_candidateInput({
      channel,
      limit,
    }).pipe(Effect.mapError(invalidInput));

    const table = sql(lane === "inbox" ? "channel_inbox" : "channel_outbox");

    const receivedAt =
      lane === "inbox" ? sql`q.received_at` : sql`q.created_at`;

    const visibility = lane === "inbox" ? sql`i.revoked_at IS NULL` : sql`TRUE`;

    const cancelRevoked =
      lane === "outbox" ? sql`i.revoked_at IS NOT NULL` : sql`FALSE`;

    const recoverable =
      lane === "inbox"
        ? sql`q.status = 'uncertain' AND q.native_input IS NOT NULL`
        : sql`FALSE`;

    // Outbox may park a queued row until lease_expires_at after HTTP 429.
    const queuedReady =
      lane === "outbox"
        ? sql`q.status = 'queued' AND (q.lease_expires_at IS NULL OR q.lease_expires_at <= clock_timestamp())`
        : sql`q.status = 'queued'`;

    const rows = yield* sql`SELECT ${identityColumns}
      FROM channel_identity i
      JOIN LATERAL (
        SELECT min(${receivedAt}) AS oldest FROM ${table} q
        WHERE q.identity_id = i.id AND (
          (${recoverable})
          OR (q.status = 'dispatching' AND q.lease_expires_at <= clock_timestamp())
          OR ((${queuedReady}) AND (${cancelRevoked} OR NOT EXISTS (
            SELECT 1 FROM ${table} blocker WHERE blocker.identity_id = i.id AND (
              blocker.status = 'uncertain' OR
              (blocker.status = 'dispatching' AND blocker.lease_expires_at > clock_timestamp())
            )
          )))
        )
      ) eligible ON eligible.oldest IS NOT NULL
      WHERE i.channel = ${input.channel} AND ${visibility}
      ORDER BY eligible.oldest, i.id LIMIT ${input.limit}`;

    return yield* decodeSchema_Array_IdentitySchema(
      rows
    );
  });

  const installationMatches = Effect.fn("ChannelTransport.installationMatches")(
    function* (identity: Identity) {
      const configured =
        identity.channel === "telegram"
          ? (yield* Config.all({
              botId: Config.string("TELEGRAM_BOT_ID"),
              botUsername: Config.string("TELEGRAM_BOT_USERNAME"),
            }).pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(TelegramInstallationSchema)
              )
            )).botId
          : (yield* Config.all({
              phoneNumberId: Config.string("KAPSO_PHONE_NUMBER_ID"),
              phoneNumber: Config.string("KAPSO_PHONE_NUMBER"),
            }).pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(KapsoInstallationSchema)
              )
            )).phoneNumberId;

      if (configured !== identity.installationId)
        return yield* new ChannelTransportError({
          reason: "installation_mismatch",
        });

      return undefined;
    },
    Effect.catchTags({
      ConfigError: () => new ChannelTransportError({ reason: "configuration" }),
      SchemaError: () => new ChannelTransportError({ reason: "configuration" }),
    })
  );

  const dispatch = Effect.fn("ChannelTransport.dispatch")(function* (
    claim: MessageClaim
  ) {
    const lease = {
      id: claim.id,
      identityId: claim.identityId,
      leaseToken: claim.leaseToken,
    };

    const identity = yield* Effect.gen(function* () {
      if (claim.payload.attachments?.length || !claim.payload.text)
        return yield* new ChannelTransportError({
          reason: "unsupported_payload",
        });
      const stored = yield* findIdentity(claim.identityId);
      const current = yield* activeIdentity(claim.identityId, stored.channel);
      yield* installationMatches(current);

      return current;
    }).pipe(
      Effect.catchTag("ChannelTransportError", (error) =>
        messaging
          .markOutboxFailed({ lease, reason: "adapter_rejected" })
          .pipe(Effect.andThen(Effect.fail(error)))
      )
    );

    yield* messaging.checkOutboxLease(lease);

    // No SQL transaction spans provider I/O. Only a confirmed receipt can mark sent.
    const send =
      identity.channel === "telegram" ? telegram.sendText : kapso.sendText;

    return yield* send(
      identity.senderId,
      claim.payload.text ?? "",
      claim.payload.replyToMessageId
    ).pipe(
      Effect.flatMap((receipt) =>
        messaging
          .markSent({ lease, receipt: { status: "sent", ...receipt } })
          .pipe(Effect.as("sent" as const))
      ),
      Effect.catchTags({
        ProviderRejected: () =>
          messaging
            .markOutboxFailed({ lease, reason: "adapter_rejected" })
            .pipe(Effect.as("failed" as const)),
        ProviderRetryable: (error) =>
          messaging
            .scheduleOutboxRetry({
              lease,
              retryAfterSeconds: error.retryAfterSeconds,
            })
            .pipe(Effect.as("deferred" as const)),
        ProviderUncertain: () =>
          messaging
            .markOutboxUncertain({ lease, reason: "handoff_unknown" })
            .pipe(Effect.as("uncertain" as const)),
        ProviderInputError: (error) =>
          messaging
            .markOutboxFailed({ lease, reason: "adapter_rejected" })
            .pipe(
              Effect.andThen(
                Effect.fail(
                  new ChannelTransportError({
                    reason:
                      error.reason === "configuration"
                        ? "configuration"
                        : "invalid_input",
                  })
                )
              )
            ),
      })
    );
  });

  const enqueueText = Effect.fn("ChannelTransport.enqueueText")(function* (
    input: typeof enqueueInput.Type
  ) {
    const value = yield* decodeEnqueueInput(input).pipe(Effect.mapError(invalidInput));

    const identity = yield* findIdentity(value.identityId);
    yield* activeIdentity(identity.id, identity.channel);
    const chunks = yield* splitChannelText(value.text);

    const payloads = yield* Effect.forEach(
      chunks,
      (text) => {
        const payload: Schema.MutableJsonObject = { text };

        if (value.inputRequest !== undefined)
          payload.inputRequest = { ...value.inputRequest };

        if (value.replyToMessageId !== undefined)
          payload.replyToMessageId = value.replyToMessageId;

        return decodeMessagePayloadSchema(payload).pipe(
          Effect.mapError(invalidInput)
        );
      },
      { concurrency: 1 }
    );

    return yield* sql.withTransaction(
      Effect.gen(function* () {
        // Reserve the numeric suffix namespace under Messaging's identity lock.
        // At most five chunks are valid; a sixth existing key already proves conflict.
        yield* sql`SELECT id FROM channel_identity WHERE id = ${value.identityId} FOR UPDATE`;
        const prefix = `${value.deliveryKey}:`;
        const keys = payloads.map((_, index) => `${prefix}${String(index)}`);

        const existing = yield* sql<{
          id: string;
          key: string;
        }>`SELECT id, delivery_key AS key FROM channel_outbox
          WHERE identity_id = ${value.identityId}
            AND left(delivery_key, char_length(${prefix})) = ${prefix}
            AND substring(delivery_key FROM char_length(${prefix}) + 1) ~ '^[0-9]+$'
          LIMIT 6`;

        if (
          existing[0] &&
          (existing.length !== keys.length ||
            existing.some((row) => !keys.includes(row.key)))
        )
          return yield* new PayloadConflict({ id: existing[0].id });

        return yield* Effect.forEach(
          payloads,
          (payload, index) =>
            messaging.enqueue({
              identityId: value.identityId,
              deliveryKey: `${value.deliveryKey}:${String(index)}`,
              payload,
            }),
          { concurrency: 1 }
        );
      })
    );
  });

  const enqueueTaskReport = Effect.fn("ChannelTransport.enqueueTaskReport")(
    function* (input: typeof enqueueInput.Type) {
      const value = yield* decodeEnqueueInput2(input).pipe(Effect.mapError(invalidInput));

      yield* decodeSchema_String_check_Schema_isPattern_task_report_0(value.deliveryKey).pipe(Effect.mapError(invalidInput));
      yield* sql`SELECT id FROM channel_identity WHERE id = ${value.identityId} FOR UPDATE`;
      const identity = yield* findIdentity(value.identityId);
      yield* activeIdentity(identity.id, identity.channel);
      const prefix = `${value.deliveryKey}:`;

      const existing = yield* sql<{
        key: string;
        payload: unknown;
      }>`SELECT delivery_key AS key, payload FROM channel_outbox
        WHERE identity_id = ${value.identityId}
          AND left(delivery_key, char_length(${prefix})) = ${prefix}
        ORDER BY delivery_key LIMIT 6`;

      if (!existing.length) return yield* enqueueText(value);

      if (
        existing.length > 5 ||
        existing.some((row, index) => row.key !== `${prefix}${String(index)}`)
      )
        return yield* invalidInput();

      return yield* Effect.forEach(
        existing,
        Effect.fn("ChannelTransport.enqueueExistingDelivery")(function* (row) {
          const payload = yield* decodeMessagePayloadSchema(row.payload).pipe(Effect.mapError(invalidInput));

          return yield* messaging.enqueue({
            identityId: value.identityId,
            deliveryKey: row.key,
            payload,
          });
        }),
        { concurrency: 1 }
      );
    },
    sql.withTransaction
  );

  return {
    activeIdentity,
    deliveredInput: Effect.fn("ChannelTransport.deliveredInput")(function* (
      identityId: string,
      reference: typeof InputDeliveryReferenceSchema.Type
    ) {
      const id = yield* decodeIdentityId(identityId).pipe(
        Effect.mapError(invalidInput)
      );

      const value = yield* decodeInputDeliveryReferenceSchema(reference).pipe(Effect.mapError(invalidInput));

      const prefix = `input:${value.sessionId}:${value.requestId}:`;

      const rows = yield* sql`SELECT delivery_key AS key, payload, status,
        (extract(epoch FROM sent_at) * 1000)::float8 AS "sentAtMs",
        provider_message_id AS "providerMessageId"
        FROM channel_outbox WHERE identity_id = ${id}
          AND left(delivery_key, char_length(${prefix})) = ${prefix}
          AND substring(delivery_key FROM char_length(${prefix}) + 1) ~ '^[0-9]+$'
        ORDER BY sequence LIMIT 6`;

      const chunks = yield* decodeSchema_Array_Schema_Struct_key_Schema_String_paylo(rows).pipe(Effect.mapError(invalidInput));

      if (chunks.length === 0 || chunks.length > 5) return null;
      let deliveredAtMs = 0;
      const text: string[] = [];
      const providerMessageIds: string[] = [];

      for (const [index, chunk] of chunks.entries()) {
        const delivered = chunk.payload.inputRequest;

        if (
          chunk.key !== `${prefix}${String(index)}` ||
          chunk.status !== "sent" ||
          chunk.sentAtMs === null ||
          !chunk.providerMessageId ||
          !chunk.payload.text ||
          delivered?.sessionId !== value.sessionId ||
          delivered.requestId !== value.requestId ||
          delivered.revision !== value.revision
        )
          return null;
        deliveredAtMs = Math.max(deliveredAtMs, chunk.sentAtMs);
        text.push(chunk.payload.text);
        providerMessageIds.push(chunk.providerMessageId);
      }

      const receiptId = providerMessageIds[0];

      if (!receiptId) return null;

      return {
        ...value,
        identityId: id,
        deliveredAtMs,
        text: text.join(""),
        receiptId,
        providerMessageIds,
      };
    }),
    inboxCandidates: (channel: Identity["channel"], limit: number) =>
      candidates("inbox", channel, limit),
    outboxCandidates: (channel: Identity["channel"], limit: number) =>
      candidates("outbox", channel, limit),
    enqueueText,
    enqueueTaskReport,
    drainOutbox: Effect.fn("ChannelTransport.drainOutbox")(function* (
      identityId: string
    ) {
      const id = yield* decodeIdentityId(identityId).pipe(
        Effect.mapError(invalidInput)
      );

      let sent = 0;
      let result: DrainOutboxResult | null = null;

      yield* Effect.forEach(
        Array.from({ length: 8 }, (_, index) => index),
        Effect.fn("ChannelTransport.drainOutbox.attempt")(function* () {
          if (result) return;

          const claim = yield* messaging.claimOutbox({
            identityId: id,
            leaseSeconds: 30,
          });

          if (!claim) {
            const remaining = yield* messaging.inspectOutbox(id);

            const uncertain =
              remaining.counts.find((count) => count.status === "uncertain")
                ?.count ?? 0;

            if (uncertain > 0) {
              result = {
                state: "uncertain",
                sent,
                failed: 0,
                uncertain,
              } satisfies DrainOutboxResult;

              return;
            }

            const blocked = remaining.counts.some(
              (count) =>
                count.status === "queued" || count.status === "dispatching"
            );

            if (blocked) {
              result = {
                state: "blocked",
                sent,
                failed: 0,
                uncertain: 0,
              } satisfies DrainOutboxResult;

              return;
            }

            result = {
              state: sent > 0 ? "sent" : "idle",
              sent,
              failed: 0,
              uncertain: 0,
            } satisfies DrainOutboxResult;

            return;
          }

          const state = yield* dispatch(claim);

          if (state !== "sent") {
            result = {
              state,
              sent,
              failed: state === "failed" ? 1 : 0,
              uncertain: state === "uncertain" ? 1 : 0,
            } satisfies DrainOutboxResult;

            return;
          }

          sent += 1;
        }),
        { concurrency: 1, discard: true }
      );

      return (
        result ??
        ({
          state: "limit",
          sent,
          failed: 0,
          uncertain: 0,
        } satisfies DrainOutboxResult)
      );
    }),
  };
});

export class ChannelTransport extends Context.Service<
  ChannelTransport,
  Effect.Success<typeof makeTransport>
>()("companion/server/channels/ChannelTransport") {
  static readonly layer = Layer.effect(ChannelTransport, makeTransport);
}
