import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";

export const IdentityId = Schema.String.check(Schema.isUUID());
const reference = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isTrimmed()
);

export const MessagePayloadSchema = Schema.Struct({
  text: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_384))
  ),
  attachments: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: reference,
        mediaType: Schema.String.check(
          Schema.isMinLength(1),
          Schema.isMaxLength(128)
        ),
        name: Schema.optionalKey(reference),
      })
    ).check(Schema.isMaxLength(10))
  ),
  replyToMessageId: Schema.optionalKey(reference),
}).check(
  Schema.makeFilter(
    (message) =>
      Boolean(message.text?.trim()) || (message.attachments?.length ?? 0) > 0,
    { message: "A message needs text or an attachment reference." }
  )
);
export type MessagePayload = typeof MessagePayloadSchema.Type;

export const AcceptInputSchema = Schema.Struct({
  identityId: IdentityId,
  eventId: reference,
  payload: MessagePayloadSchema,
});
export type AcceptInput = typeof AcceptInputSchema.Type;
export const EnqueueInputSchema = Schema.Struct({
  identityId: IdentityId,
  deliveryKey: reference,
  payload: MessagePayloadSchema,
});
export type EnqueueInput = typeof EnqueueInputSchema.Type;

export const ClaimInputSchema = Schema.Struct({
  identityId: IdentityId,
  leaseSeconds: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 300 })
  ),
});
export type ClaimInput = typeof ClaimInputSchema.Type;
export const LeaseSchema = Schema.Struct({
  identityId: IdentityId,
  id: IdentityId,
  leaseToken: IdentityId,
});
export type Lease = typeof LeaseSchema.Type;

export const DeliveryFailureSchema = Schema.Literals([
  "adapter_rejected",
  "adapter_unavailable",
  "handoff_unknown",
  "lease_expired",
  "identity_revoked",
]);
export type DeliveryFailure = typeof DeliveryFailureSchema.Type;

export const MessageStatus = Schema.Literals([
  "queued",
  "dispatching",
  "accepted",
  "sent",
  "uncertain",
  "failed",
  "cancelled",
]);
export const MessageReceiptSchema = Schema.Struct({
  id: IdentityId,
  identityId: IdentityId,
  key: reference,
  payload: MessagePayloadSchema,
  status: MessageStatus,
  attempts: Schema.Int,
  leaseToken: Schema.NullOr(IdentityId),
  leaseExpiresAt: Schema.NullOr(Schema.String),
  resultId: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
});
export type MessageReceipt = typeof MessageReceiptSchema.Type;
export const MessageClaimSchema = Schema.Struct({
  ...MessageReceiptSchema.fields,
  status: Schema.Literal("dispatching"),
  leaseToken: IdentityId,
  leaseExpiresAt: Schema.String,
});
export type MessageClaim = typeof MessageClaimSchema.Type;

export class InvalidMessage extends Schema.TaggedError<InvalidMessage>()(
  "InvalidMessage",
  { message: Schema.String }
) {}
export class IdentityInactive extends Schema.TaggedError<IdentityInactive>()(
  "IdentityInactive",
  { identityId: IdentityId }
) {}
export class PayloadConflict extends Schema.TaggedError<PayloadConflict>()(
  "PayloadConflict",
  { id: IdentityId }
) {}
export class LeaseLost extends Schema.TaggedError<LeaseLost>()("LeaseLost", {
  id: IdentityId,
}) {}
export class MessagingStorageError extends Schema.TaggedError<MessagingStorageError>()(
  "MessagingStorageError",
  { message: Schema.String }
) {}

export type MessagingError =
  | InvalidMessage
  | IdentityInactive
  | PayloadConflict
  | LeaseLost
  | MessagingStorageError;

export const decodeInput = <S extends Schema.Constraint>(schema: S) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" });

export const invalidInput = () =>
  new InvalidMessage({ message: "Invalid messaging input." });

// The domain has a fixed set of object keys. Reconstructing those keys in this
// order canonicalizes JSON objects without changing meaningful array order.
export function canonicalPayload(payload: MessagePayload) {
  const normalized: MessagePayload = {
    text: payload.text,
    attachments: (payload.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      mediaType: attachment.mediaType,
      name: attachment.name,
    })),
    replyToMessageId: payload.replyToMessageId,
  };
  return {
    payload: normalized,
    hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}

export const decodeReceipt = Effect.fn("Messaging.decodeReceipt")(
  Schema.decodeUnknownEffect(MessageReceiptSchema),
  Effect.mapError(
    () => new MessagingStorageError({ message: "Invalid messaging record." })
  )
);
