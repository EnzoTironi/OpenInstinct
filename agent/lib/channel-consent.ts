import { createHash } from "node:crypto";
import { Predicate, Result, Schema } from "effect";
import { parseInputResponse, type InputRequest } from "eve/client";

const identifier = Schema.NonEmptyString.check(
  Schema.isTrimmed(),
  Schema.isMaxLength(256)
);
const revision = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const reference = Schema.Struct({ requestId: identifier, revision });
const candidateSchema = Schema.Struct({
  intent: Schema.Literals([
    "approve",
    "cancel",
    "correct",
    "clarify",
    "conversation",
  ]),
  references: Schema.Array(reference).check(Schema.isMaxLength(16)),
});
const decodeCandidate = Schema.decodeUnknownResult(candidateSchema, {
  onExcessProperty: "error",
});

type ConsentJsonValue = InputRequest["action"]["input"][string] | undefined;

type ActionIntent = "approve" | "cancel" | "correct";

const sourceSchema = Schema.Struct({
  sourceMessageId: identifier,
  identityId: identifier,
  sessionId: identifier,
  text: Schema.NonEmptyString.check(Schema.isMaxLength(16_384)),
  sourceOccurredAtMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
const decodeSource = Schema.decodeUnknownResult(sourceSchema, {
  onExcessProperty: "error",
});

/** Supplied by verified intake, never by the interpreting model. Times are epoch milliseconds. */
export type ChannelConsentSource = typeof sourceSchema.Type;

const deliverySchema = Schema.Struct({
  receiptId: identifier,
  ...reference.fields,
  identityId: identifier,
  sessionId: identifier,
  deliveredAtMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  text: Schema.NonEmptyString.check(Schema.isMaxLength(16_384)),
  providerMessageIds: Schema.Array(identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16)
  ),
});
const decodeDelivery = Schema.decodeUnknownResult(deliverySchema);

/** Confirmed delivery of ALL proposal chunks; deliveredAtMs is their latest send receipt. */
export type ChannelConsentDelivery = typeof deliverySchema.Type;

export interface ChannelConsentSnapshot {
  readonly identityId: string;
  readonly sessionId: string;
  readonly pending: readonly InputRequest[];
  readonly deliveries: readonly ChannelConsentDelivery[];
  /** Source messages already consumed as decisions, not merely accepted into the inbox. */
  readonly consumedSourceMessageIds: readonly string[];
}

export interface ChannelConsentInterpretation {
  /** The orchestration envelope binds the model invocation to its complete source text. */
  readonly sourceMessageId: string;
  readonly sourceText: string;
  readonly candidate: unknown;
}

type Rejection =
  | "invalid_candidate"
  | "invalid_source"
  | "source_mismatch"
  | "scope_mismatch"
  | "replayed_source"
  | "ambiguous_reference"
  | "stale_request"
  | "stale_revision"
  | "unsupported_request"
  | "missing_delivery"
  | "ambiguous_delivery"
  | "delivery_not_before_source";

export type ChannelConsentDecision =
  | { readonly status: "rejected"; readonly reason: Rejection }
  | {
      readonly status: "non_action";
      readonly intent: "clarify" | "conversation";
    }
  | {
      readonly status: "validated";
      readonly intent: ActionIntent;
      readonly binding: ChannelConsentSource & {
        readonly requestId: InputRequest["requestId"];
        readonly revision: string;
        readonly deliveryReceiptId: string;
        readonly deliveryProviderMessageIds: readonly string[];
      };
      /** Correction only cancels the old request; it never approves replacement arguments. */
      readonly response: ReturnType<typeof parseInputResponse>;
    };

/** Includes action, options and prompt; object key order is immaterial, array order is not. */
export function channelConsentRevision(request: InputRequest): string {
  const serialized = JSON.stringify(request, (_key, value: ConsentJsonValue) =>
    Array.isArray(value)
      ? value
      : Predicate.isObject(value)
        ? Object.fromEntries(
            Object.keys(value)
              .toSorted()
              .map((key) => [key, value[key]])
          )
        : value
  );
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Validates references, not the semantic truth of a model's interpretation.
 * The caller must revalidate live authority and atomically fence consumption before dispatch.
 * A successful return performs no mutation and is not an execution receipt.
 */
export function validateChannelConsent(
  source: ChannelConsentSource,
  interpretation: ChannelConsentInterpretation,
  snapshot: ChannelConsentSnapshot
): ChannelConsentDecision {
  const sourceRejection = validateConsentSource(
    source,
    interpretation,
    snapshot
  );
  if (sourceRejection) return { status: "rejected", reason: sourceRejection };
  const decoded = decodeCandidate(interpretation.candidate);
  if (Result.isFailure(decoded))
    return { status: "rejected", reason: "invalid_candidate" };
  const candidate = decoded.success;
  if (candidate.intent === "clarify" || candidate.intent === "conversation") {
    return candidate.references.length === 0
      ? { status: "non_action", intent: candidate.intent }
      : { status: "rejected", reason: "invalid_candidate" };
  }
  const [target] = candidate.references;
  if (candidate.references.length !== 1 || !target) {
    return { status: "rejected", reason: "ambiguous_reference" };
  }
  const matches = snapshot.pending.filter(
    (request) => request.requestId === target.requestId
  );
  const [request] = matches;
  if (!request) return { status: "rejected", reason: "stale_request" };
  if (matches.length !== 1)
    return { status: "rejected", reason: "ambiguous_reference" };
  if (channelConsentRevision(request) !== target.revision) {
    return { status: "rejected", reason: "stale_revision" };
  }
  const optionId = candidate.intent === "approve" ? "approve" : "cancel";
  if (
    request.kind !== "tool-approval" ||
    request.options?.filter((option) => option.id === optionId).length !== 1
  ) {
    return { status: "rejected", reason: "unsupported_request" };
  }
  const deliveryResult = resolveConsentDelivery(
    source,
    target,
    snapshot.deliveries
  );
  if (Result.isFailure(deliveryResult))
    return { status: "rejected", reason: deliveryResult.failure };
  const delivery = deliveryResult.success;
  return {
    status: "validated",
    intent: candidate.intent,
    binding: {
      ...source,
      requestId: request.requestId,
      revision: target.revision,
      deliveryReceiptId: delivery.receiptId,
      deliveryProviderMessageIds: [...delivery.providerMessageIds],
    },
    response: parseInputResponse({ requestId: request.requestId, optionId }),
  };
}

function validateConsentSource(
  source: ChannelConsentSource,
  interpretation: ChannelConsentInterpretation,
  snapshot: ChannelConsentSnapshot
): Rejection | undefined {
  if (Result.isFailure(decodeSource(source)) || !source.text.trim()) {
    return "invalid_source";
  }
  if (
    source.sourceMessageId !== interpretation.sourceMessageId ||
    source.text !== interpretation.sourceText
  ) {
    return "source_mismatch";
  }
  if (
    source.identityId !== snapshot.identityId ||
    source.sessionId !== snapshot.sessionId
  ) {
    return "scope_mismatch";
  }
  if (snapshot.consumedSourceMessageIds.includes(source.sourceMessageId)) {
    return "replayed_source";
  }
  return undefined;
}

function resolveConsentDelivery(
  source: ChannelConsentSource,
  target: typeof reference.Type,
  receipts: readonly ChannelConsentDelivery[]
): Result.Result<ChannelConsentDelivery, Rejection> {
  const deliveries = receipts.filter(
    (delivery) =>
      delivery.requestId === target.requestId &&
      delivery.revision === target.revision &&
      delivery.identityId === source.identityId &&
      delivery.sessionId === source.sessionId
  );
  const [delivery] = deliveries;
  if (!delivery) return Result.fail("missing_delivery");
  if (deliveries.length !== 1) return Result.fail("ambiguous_delivery");
  if (
    !Number.isFinite(delivery.deliveredAtMs) ||
    delivery.deliveredAtMs >= source.sourceOccurredAtMs
  ) {
    return Result.fail("delivery_not_before_source");
  }
  if (
    Result.isFailure(decodeDelivery(delivery)) ||
    !delivery.text.trim() ||
    new Set(delivery.providerMessageIds).size !==
      delivery.providerMessageIds.length ||
    !delivery.providerMessageIds.includes(delivery.receiptId)
  ) {
    return Result.fail("missing_delivery");
  }
  return Result.succeed(delivery);
}
