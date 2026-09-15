import { Schema } from "effect";

import { BitemporalCoordinates } from "./bitemporal";
import { computeCanonicalDigest } from "./digest";
import { Subject } from "./security";
import { DataClassification, ObjectTypeId } from "./types";

export const ClaimState = Schema.Literals([
  "proposed",
  "supported",
  "accepted",
  "contested",
  "superseded",
  "retracted",
  "unknown",
]);
export type ClaimState = typeof ClaimState.Type;

export const Claim = Schema.Struct({
  attribution: Subject,
  claimId: Schema.String,
  confidence: Schema.Number,
  conflictReason: Schema.optional(Schema.String),
  effectiveTime: Schema.Number,
  evidenceDigest: Schema.String,
  propertyName: Schema.String,
  propertyValue: Schema.Json,
  recordedAt: Schema.Number,
  sourceSystem: Schema.String,
  state: ClaimState,
  subjectId: Schema.String,
  targetTypeId: ObjectTypeId,
});
export type Claim = typeof Claim.Type;

export const EvidenceClosure = Schema.Struct({
  dependencyPredicate: Schema.optional(Schema.String),
  maxStalenessMs: Schema.Number,
  requiredInputs: Schema.Array(Schema.String),
  sourceRevision: Schema.String,
});
export type EvidenceClosure = typeof EvidenceClosure.Type;

export const CanonicalEvidenceEnvelope = Schema.Struct({
  author: Subject,
  classification: DataClassification,
  contentDigest: Schema.String,
  effectiveTime: Schema.Number,
  envelopeId: Schema.String,
  evidenceClosure: Schema.optional(EvidenceClosure),
  externalId: Schema.String,
  rawPayload: Schema.Json,
  receivedAt: Schema.Number,
  sourceSystem: Schema.String,
  targetTypeId: ObjectTypeId,
});
export type CanonicalEvidenceEnvelope = typeof CanonicalEvidenceEnvelope.Type;

export const AdmissionReceipt = Schema.Struct({
  admissionId: Schema.String,
  admittedAt: Schema.Number,
  admittedBy: Subject,
  bitemporal: BitemporalCoordinates,
  claims: Schema.Array(Claim),
  conflictingClaims: Schema.Array(Claim),
  envelopeId: Schema.String,
  receiptDigest: Schema.String,
  status: Schema.Literals(["admitted", "contested", "quarantined"]),
  subjectId: Schema.String,
  targetTypeId: ObjectTypeId,
});
export type AdmissionReceipt = typeof AdmissionReceipt.Type;

export interface AdmissionReceiptDigestInput {
  readonly envelopeId: string;
  readonly subjectId: string;
  readonly targetTypeId: string;
  readonly status: string;
  readonly admittedAt: number;
  readonly claims: readonly Schema.Json[];
  readonly conflictingClaims: readonly Schema.Json[];
}

export function computeAdmissionReceiptDigest(
  receipt: AdmissionReceiptDigestInput
): string {
  return computeCanonicalDigest({
    admittedAt: receipt.admittedAt,
    claims: [...receipt.claims],
    conflictingClaims: [...receipt.conflictingClaims],
    envelopeId: receipt.envelopeId,
    status: receipt.status,
    subjectId: receipt.subjectId,
    targetTypeId: receipt.targetTypeId,
  });
}
