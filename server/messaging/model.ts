import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { channelProviderSchema } from "../../shared/identity/channel-auth";

export const IdentityId = Schema.String.check(Schema.isUUID());
const reference = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isTrimmed()
);

export const InputDeliveryReferenceSchema = Schema.Struct({
  sessionId: reference,
  requestId: reference,
  revision: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});

export const ClaimChannelInputResponseSchema = Schema.Struct({
  ...InputDeliveryReferenceSchema.fields,
  identityId: IdentityId,
  sourceMessageId: reference,
  turnId: reference,
  decision: Schema.Literals(["approve", "cancel"]),
});
export type ClaimChannelInputResponse =
  typeof ClaimChannelInputResponseSchema.Type;
export const MarkChannelInputResponseSchema = Schema.Struct({
  id: IdentityId,
  status: Schema.Literals(["accepted", "uncertain"]),
});

export const MessagePayloadSchema = Schema.Struct({
  inputRequest: Schema.optionalKey(InputDeliveryReferenceSchema),
  sourceOccurredAtMs: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
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
  sourceMessageId: reference,
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

const actorPrincipal = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isTrimmed()
);
const resolutionNote = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.isTrimmed()
);
const providerMessageId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isTrimmed()
);

export const OutboxResolutionDecisionSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("mark_delivered"),
    providerMessageId,
  }),
  Schema.Struct({
    kind: Schema.Literal("cancel"),
    reason: Schema.Literals([
      "operator_cancelled",
      "duplicate_confirmed",
      "abandoned",
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal("authorize_retry"),
    acknowledgment: Schema.Literal("duplicate_delivery_risk_accepted"),
  }),
]);
export type OutboxResolutionDecision =
  typeof OutboxResolutionDecisionSchema.Type;

export const ResolveOutboxUncertainSchema = Schema.Struct({
  identityId: IdentityId,
  id: IdentityId,
  decision: OutboxResolutionDecisionSchema,
  actorPrincipalId: actorPrincipal,
  note: Schema.optionalKey(resolutionNote),
});
export type ResolveOutboxUncertainInput =
  typeof ResolveOutboxUncertainSchema.Type;

export const DeliveryFailureSchema = Schema.Literals([
  "adapter_rejected",
  "adapter_unavailable",
  "adapter_rate_limited",
  "handoff_unknown",
  "lease_expired",
  "identity_revoked",
]);
export type DeliveryFailure = typeof DeliveryFailureSchema.Type;

const MessageStatus = Schema.Literals([
  "queued",
  "dispatching",
  "accepted",
  "sent",
  "uncertain",
  "failed",
  "cancelled",
]);
export const NativeInboxContentSchema = Schema.Union([
  Schema.NonEmptyString,
  Schema.Array(
    Schema.Struct({ type: Schema.Literal("text"), text: Schema.NonEmptyString })
  ).check(Schema.isMinLength(1)),
]).annotate({ parseOptions: { onExcessProperty: "error" } });
export const NativeInboxHandoffSchema = Schema.Struct({
  protocol: Schema.Literal("eve-keyed-input-v1"),
  inputId: IdentityId,
  channel: channelProviderSchema,
  address: IdentityId,
  principalId: Schema.NonEmptyString,
  content: Schema.NullOr(NativeInboxContentSchema),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export const ChannelTranscriptSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(3000),
  Schema.makeFilter((text) => text.isWellFormed())
);
export const PrepareInboxHandoffSchema = Schema.Struct({
  lease: LeaseSchema,
  content: NativeInboxContentSchema,
  transcripts: Schema.Array(ChannelTranscriptSchema).check(
    Schema.isMaxLength(10)
  ),
});

const MessageReceiptSchema = Schema.Struct({
  id: IdentityId,
  identityId: IdentityId,
  key: reference,
  sourceMessageId: Schema.NullOr(reference),
  payload: MessagePayloadSchema,
  nativeInput: Schema.NullOr(NativeInboxHandoffSchema),
  status: MessageStatus,
  attempts: Schema.Int,
  leaseToken: Schema.NullOr(IdentityId),
  leaseExpiresAt: Schema.NullOr(Schema.String),
  resultId: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
});
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
export class OutboxResolutionRejected extends Schema.TaggedError<OutboxResolutionRejected>()(
  "OutboxResolutionRejected",
  {
    id: IdentityId,
    reason: Schema.Literals([
      "not_uncertain",
      "conflict",
      "identity_inactive",
    ]),
  }
) {}
export class MessagingStorageError extends Schema.TaggedError<MessagingStorageError>()(
  "MessagingStorageError",
  { message: Schema.String }
) {}

export type MessagingError =
  | InvalidMessage
  | IdentityInactive
  | PayloadConflict
  | LeaseLost
  | OutboxResolutionRejected
  | MessagingStorageError;

export const decodeInput = <S extends Schema.Constraint>(schema: S) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" });

export const invalidInput = () =>
  new InvalidMessage({ message: "Invalid messaging input." });

// The domain has a fixed set of object keys. Reconstructing those keys in this
// order canonicalizes JSON objects without changing meaningful array order.
export function canonicalPayload(payload: MessagePayload) {
  const normalized: MessagePayload = {
    inputRequest: payload.inputRequest
      ? {
          sessionId: payload.inputRequest.sessionId,
          requestId: payload.inputRequest.requestId,
          revision: payload.inputRequest.revision,
        }
      : undefined,
    sourceOccurredAtMs: payload.sourceOccurredAtMs,
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
