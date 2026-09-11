import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { createInputResponses } from "./input-response";
import {
  AcceptInputSchema,
  type AcceptInput,
  ClaimInputSchema,
  type ClaimInput,
  decodeInput,
  DeliveryFailureSchema,
  EnqueueInputSchema,
  type EnqueueInput,
  IdentityId,
  invalidInput,
  NativeInboxContentSchema,
  NativeInboxHandoffSchema,
  PrepareInboxHandoffSchema,
  PayloadConflict,
  LeaseSchema,
  type Lease,
  type MessagingError,
  ResolveOutboxUncertainSchema,
  type ResolveOutboxUncertainInput,
} from "./model";
import { createQueue, storageFailure } from "./store";

type Queue = ReturnType<typeof createQueue>;

const encodeSchema_fromJsonString_NativeInboxContentSchema =
  Schema.encodeEffect(Schema.fromJsonString(NativeInboxContentSchema));

const decodeSchema_Struct_NativeInboxHandoffSchema_fields_cont =
  Schema.decodeUnknownEffect(
    Schema.Struct({
      ...NativeInboxHandoffSchema.fields,
      content: NativeInboxContentSchema,
    })
  );

export * from "./model";

const adapterId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isTrimmed()
);

const accepted = Schema.Struct({
  lease: LeaseSchema,
  receipt: Schema.Struct({
    status: Schema.Literal("accepted"),
    sessionId: adapterId,
  }),
});

const sent = Schema.Struct({
  lease: LeaseSchema,
  receipt: Schema.Struct({
    status: Schema.Literal("sent"),
    providerMessageId: adapterId,
  }),
});

const stopped = Schema.Struct({
  lease: LeaseSchema,
  reason: DeliveryFailureSchema,
});

const rejected = Schema.Struct({
  lease: LeaseSchema,
  reason: Schema.Literal("adapter_rejected"),
});

const scheduleRetryInput = Schema.Struct({
  lease: LeaseSchema,
  retryAfterSeconds: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 3_600 })
  ),
});

function protect<A, R>(
  operation: Effect.Effect<A, MessagingError | SqlError | Schema.SchemaError, R>
) {
  return operation.pipe(
    Effect.catchTags({
      SqlError: storageFailure,
      SchemaError: invalidInput,
    })
  );
}

interface MessagingDeps {
  sql: PgClient.PgClient;
  inbox: Queue;
  outbox: Queue;
  inputResponses: ReturnType<typeof createInputResponses>;
}

const acceptMessage = (deps: MessagingDeps) =>
  Effect.fn("Messaging.accept")(function* (input: AcceptInput) {
    const value = yield* decodeInput(AcceptInputSchema)(input);

    return yield* deps.inbox.insert({ ...value, key: value.eventId });
  }, protect);

const enqueueMessage = (deps: MessagingDeps) =>
  Effect.fn("Messaging.enqueue")(function* (input: EnqueueInput) {
    const value = yield* decodeInput(EnqueueInputSchema)(input);

    return yield* deps.outbox.insert({
      ...value,
      key: value.deliveryKey,
      sourceMessageId: null,
    });
  }, protect);

const claimInbox = (deps: MessagingDeps) =>
  Effect.fn("Messaging.claimInbox")(function* (input: ClaimInput) {
    const value = yield* decodeInput(ClaimInputSchema)(input);

    return yield* deps.inbox.claim(value.identityId, value.leaseSeconds);
  }, protect);

const insertHandoffTranscripts = (
  deps: MessagingDeps,
  identityId: string,
  leaseId: string,
  transcripts: readonly string[]
) =>
  Effect.forEach(
    transcripts,
    (transcript, index) =>
      deps.outbox.insert({
        identityId,
        key: `transcript:${leaseId}:${String(index)}:0`,
        sourceMessageId: null,
        payload: {
          text: `I heard: ${transcript}\nIf this is incorrect, send a correction.`,
        },
      }),
    { concurrency: 1, discard: true }
  );

const prepareInboxHandoff = (deps: MessagingDeps) =>
  Effect.fn("Messaging.prepareInboxHandoff")(
    function* (input: typeof PrepareInboxHandoffSchema.Type) {
      const value = yield* decodeInput(PrepareInboxHandoffSchema)(input);
      const current = yield* deps.inbox.checkLease(value.lease);

      const content =
        yield* encodeSchema_fromJsonString_NativeInboxContentSchema(
          value.content
        );

      const rows =
        yield* deps.sql`UPDATE channel_inbox SET native_input = jsonb_set(native_input, '{content}', ${content}::jsonb)
          WHERE id = ${value.lease.id} AND identity_id = ${value.lease.identityId}
            AND lease_token = ${value.lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
            AND (native_input->'content' = 'null'::jsonb OR native_input->'content' = ${content}::jsonb)
          RETURNING native_input AS input`;

      if (!rows[0]) {
        yield* deps.inbox.checkLease(value.lease);

        return yield* new PayloadConflict({ id: value.lease.id });
      }

      // The first preparation commits its bounded, single-chunk transcript intents.
      // Identical replays do not recreate delivered or retained-away outbox entries.
      if (current.nativeInput?.content === null) {
        yield* insertHandoffTranscripts(
          deps,
          value.lease.identityId,
          value.lease.id,
          value.transcripts
        );
      }

      return yield* decodeSchema_Struct_NativeInboxHandoffSchema_fields_cont(
        rows[0].input
      );
    },
    deps.sql.withTransaction,
    protect
  );

const claimOutbox = (deps: MessagingDeps) =>
  Effect.fn("Messaging.claimOutbox")(function* (input: ClaimInput) {
    const value = yield* decodeInput(ClaimInputSchema)(input);

    return yield* deps.outbox.claim(value.identityId, value.leaseSeconds);
  }, protect);

const markAccepted = (deps: MessagingDeps) =>
  Effect.fn("Messaging.markAccepted")(function* (input: typeof accepted.Type) {
    const value = yield* decodeInput(accepted)(input);

    return yield* deps.inbox.complete(value.lease, value.receipt.sessionId);
  }, protect);

const markSent = (deps: MessagingDeps) =>
  Effect.fn("Messaging.markSent")(function* (input: typeof sent.Type) {
    const value = yield* decodeInput(sent)(input);

    return yield* deps.outbox.complete(
      value.lease,
      value.receipt.providerMessageId
    );
  }, protect);

const markInboxUncertain = (deps: MessagingDeps) =>
  Effect.fn("Messaging.markInboxUncertain")(function* (
    input: typeof stopped.Type
  ) {
    const value = yield* decodeInput(stopped)(input);

    return yield* deps.inbox.stop(value.lease, "uncertain", value.reason);
  }, protect);

const markOutboxUncertain = (deps: MessagingDeps) =>
  Effect.fn("Messaging.markOutboxUncertain")(function* (
    input: typeof stopped.Type
  ) {
    const value = yield* decodeInput(stopped)(input);

    return yield* deps.outbox.stop(value.lease, "uncertain", value.reason);
  }, protect);

const markInboxFailed = (deps: MessagingDeps) =>
  Effect.fn("Messaging.markInboxFailed")(function* (
    input: typeof rejected.Type
  ) {
    const value = yield* decodeInput(rejected)(input);

    return yield* deps.inbox.stop(value.lease, "failed", value.reason);
  }, protect);

const markOutboxFailed = (deps: MessagingDeps) =>
  Effect.fn("Messaging.markOutboxFailed")(function* (
    input: typeof rejected.Type
  ) {
    const value = yield* decodeInput(rejected)(input);

    return yield* deps.outbox.stop(value.lease, "failed", value.reason);
  }, protect);

const resolveOutboxUncertain = (deps: MessagingDeps) =>
  Effect.fn("Messaging.resolveOutboxUncertain")(function* (
    input: ResolveOutboxUncertainInput
  ) {
    const value = yield* decodeInput(ResolveOutboxUncertainSchema)(input);

    return yield* deps.outbox.resolveUncertain(value);
  }, protect);

const scheduleOutboxRetry = (deps: MessagingDeps) =>
  Effect.fn("Messaging.scheduleOutboxRetry")(function* (
    input: typeof scheduleRetryInput.Type
  ) {
    const value = yield* decodeInput(scheduleRetryInput)(input);

    return yield* deps.outbox.scheduleRetry(
      value.lease,
      value.retryAfterSeconds
    );
  }, protect);

const checkInboxLease = (deps: MessagingDeps) =>
  Effect.fn("Messaging.checkInboxLease")(function* (input: Lease) {
    return yield* deps.inbox.checkLease(yield* decodeInput(LeaseSchema)(input));
  }, protect);

const checkOutboxLease = (deps: MessagingDeps) =>
  Effect.fn("Messaging.checkOutboxLease")(function* (input: Lease) {
    return yield* deps.outbox.checkLease(
      yield* decodeInput(LeaseSchema)(input)
    );
  }, protect);

const inspectInbox = (deps: MessagingDeps) =>
  Effect.fn("Messaging.inspectInbox")(function* (identityId: string) {
    return yield* deps.inbox.inspect(
      yield* decodeInput(IdentityId)(identityId)
    );
  }, protect);

const inspectOutbox = (deps: MessagingDeps) =>
  Effect.fn("Messaging.inspectOutbox")(function* (identityId: string) {
    return yield* deps.outbox.inspect(
      yield* decodeInput(IdentityId)(identityId)
    );
  }, protect);

function claimChannelInputResponse(deps: MessagingDeps) {
  return (...args: Parameters<typeof deps.inputResponses.claim>) =>
    protect(deps.inputResponses.claim(...args));
}

function markChannelInputResponse(deps: MessagingDeps) {
  return (...args: Parameters<typeof deps.inputResponses.mark>) =>
    protect(deps.inputResponses.mark(...args));
}

const makeMessaging = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;

  const deps: MessagingDeps = {
    sql,
    inbox: createQueue(sql, "inbox"),
    outbox: createQueue(sql, "outbox"),
    inputResponses: createInputResponses(sql),
  };

  return {
    claimChannelInputResponse: claimChannelInputResponse(deps),
    markChannelInputResponse: markChannelInputResponse(deps),
    accept: acceptMessage(deps),
    enqueue: enqueueMessage(deps),
    claimInbox: claimInbox(deps),
    prepareInboxHandoff: prepareInboxHandoff(deps),
    claimOutbox: claimOutbox(deps),
    markAccepted: markAccepted(deps),
    markSent: markSent(deps),
    markInboxUncertain: markInboxUncertain(deps),
    markOutboxUncertain: markOutboxUncertain(deps),
    markInboxFailed: markInboxFailed(deps),
    markOutboxFailed: markOutboxFailed(deps),
    resolveOutboxUncertain: resolveOutboxUncertain(deps),
    scheduleOutboxRetry: scheduleOutboxRetry(deps),
    checkInboxLease: checkInboxLease(deps),
    checkOutboxLease: checkOutboxLease(deps),
    inspectInbox: inspectInbox(deps),
    inspectOutbox: inspectOutbox(deps),
  };
});

export class Messaging extends Context.Service<
  Messaging,
  Effect.Success<typeof makeMessaging>
>()("companion/server/messaging/Messaging") {
  static readonly layer = Layer.effect(Messaging, makeMessaging);
}
