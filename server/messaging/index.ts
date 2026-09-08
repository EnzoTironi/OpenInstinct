import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
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
  LeaseSchema,
  type Lease,
  type MessagingError,
} from "./model";
import { makeQueue, storageFailure } from "./store";

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

const makeMessaging = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const inbox = makeQueue(sql, "inbox");
  const outbox = makeQueue(sql, "outbox");

  return {
    accept: Effect.fn("Messaging.accept")(function* (input: AcceptInput) {
      const value = yield* decodeInput(AcceptInputSchema)(input);
      return yield* inbox.insert({ ...value, key: value.eventId });
    }, protect),
    enqueue: Effect.fn("Messaging.enqueue")(function* (input: EnqueueInput) {
      const value = yield* decodeInput(EnqueueInputSchema)(input);
      return yield* outbox.insert({
        ...value,
        key: value.deliveryKey,
        sourceMessageId: null,
      });
    }, protect),
    claimInbox: Effect.fn("Messaging.claimInbox")(function* (
      input: ClaimInput
    ) {
      const value = yield* decodeInput(ClaimInputSchema)(input);
      return yield* inbox.claim(value.identityId, value.leaseSeconds);
    }, protect),
    claimOutbox: Effect.fn("Messaging.claimOutbox")(function* (
      input: ClaimInput
    ) {
      const value = yield* decodeInput(ClaimInputSchema)(input);
      return yield* outbox.claim(value.identityId, value.leaseSeconds);
    }, protect),
    // Consumers must pass a confirmed adapter response, never a proposed ID.
    markAccepted: Effect.fn("Messaging.markAccepted")(function* (
      input: typeof accepted.Type
    ) {
      const value = yield* decodeInput(accepted)(input);
      return yield* inbox.complete(value.lease, value.receipt.sessionId);
    }, protect),
    markSent: Effect.fn("Messaging.markSent")(function* (
      input: typeof sent.Type
    ) {
      const value = yield* decodeInput(sent)(input);
      return yield* outbox.complete(
        value.lease,
        value.receipt.providerMessageId
      );
    }, protect),
    markInboxUncertain: Effect.fn("Messaging.markInboxUncertain")(function* (
      input: typeof stopped.Type
    ) {
      const value = yield* decodeInput(stopped)(input);
      return yield* inbox.stop(value.lease, "uncertain", value.reason);
    }, protect),
    markOutboxUncertain: Effect.fn("Messaging.markOutboxUncertain")(function* (
      input: typeof stopped.Type
    ) {
      const value = yield* decodeInput(stopped)(input);
      return yield* outbox.stop(value.lease, "uncertain", value.reason);
    }, protect),
    // Failed is terminal and requires confirmed rejection/no external effect.
    // Timeouts and transport failures after dispatch belong in uncertain.
    markInboxFailed: Effect.fn("Messaging.markInboxFailed")(function* (
      input: typeof rejected.Type
    ) {
      const value = yield* decodeInput(rejected)(input);
      return yield* inbox.stop(value.lease, "failed", value.reason);
    }, protect),
    markOutboxFailed: Effect.fn("Messaging.markOutboxFailed")(function* (
      input: typeof rejected.Type
    ) {
      const value = yield* decodeInput(rejected)(input);
      return yield* outbox.stop(value.lease, "failed", value.reason);
    }, protect),
    checkInboxLease: Effect.fn("Messaging.checkInboxLease")(function* (
      input: Lease
    ) {
      return yield* inbox.checkLease(yield* decodeInput(LeaseSchema)(input));
    }, protect),
    checkOutboxLease: Effect.fn("Messaging.checkOutboxLease")(function* (
      input: Lease
    ) {
      return yield* outbox.checkLease(yield* decodeInput(LeaseSchema)(input));
    }, protect),
    inspectInbox: Effect.fn("Messaging.inspectInbox")(function* (
      identityId: string
    ) {
      return yield* inbox.inspect(yield* decodeInput(IdentityId)(identityId));
    }, protect),
    inspectOutbox: Effect.fn("Messaging.inspectOutbox")(function* (
      identityId: string
    ) {
      return yield* outbox.inspect(yield* decodeInput(IdentityId)(identityId));
    }, protect),
  };
});

export class Messaging extends Context.Service<
  Messaging,
  Effect.Success<typeof makeMessaging>
>()("companion/server/messaging/Messaging") {
  static readonly layer = Layer.effect(Messaging, makeMessaging);
}
