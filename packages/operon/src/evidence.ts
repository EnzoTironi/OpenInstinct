import { Schema } from "effect";

import { bitemporalCoordinatesSchema } from "./bitemporal";
import { computeCanonicalDigest } from "./digest";
import { subjectSchema } from "./security";
import { dataClassificationSchema, objectTypeIdSchema } from "./types";

export const claimStateSchema = Schema.Literals([
  "proposed",
  "supported",
  "accepted",
  "contested",
  "superseded",
  "retracted",
  "unknown",
]);
export type ClaimState = typeof claimStateSchema.Type;

export const claimSchema = Schema.Struct({
  attribution: subjectSchema,
  claimId: Schema.String,
  confidence: Schema.Number,
  conflictReason: Schema.optional(Schema.String),
  effectiveTime: Schema.Number,
  evidenceDigest: Schema.String,
  propertyName: Schema.String,
  propertyValue: Schema.Json,
  recordedAt: Schema.Number,
  sourceSystem: Schema.String,
  state: claimStateSchema,
  subjectId: Schema.String,
  targetTypeId: objectTypeIdSchema,
});
export type Claim = typeof claimSchema.Type;

export const evidenceClosureSchema = Schema.Struct({
  dependencyPredicate: Schema.optional(Schema.String),
  maxStalenessMs: Schema.Number,
  requiredInputs: Schema.Array(Schema.String),
  sourceRevision: Schema.String,
});
export type EvidenceClosure = typeof evidenceClosureSchema.Type;

export const canonicalEvidenceEnvelopeSchema = Schema.Struct({
  author: subjectSchema,
  classification: dataClassificationSchema,
  contentDigest: Schema.String,
  effectiveTime: Schema.Number,
  envelopeId: Schema.String,
  evidenceClosure: Schema.optional(evidenceClosureSchema),
  externalId: Schema.String,
  rawPayload: Schema.Json,
  receivedAt: Schema.Number,
  sourceSystem: Schema.String,
  targetTypeId: objectTypeIdSchema,
});
export type CanonicalEvidenceEnvelope =
  typeof canonicalEvidenceEnvelopeSchema.Type;

export const admissionReceiptSchema = Schema.Struct({
  admissionId: Schema.String,
  admittedAt: Schema.Number,
  admittedBy: subjectSchema,
  bitemporal: bitemporalCoordinatesSchema,
  claims: Schema.Array(claimSchema),
  conflictingClaims: Schema.Array(claimSchema),
  envelopeId: Schema.String,
  receiptDigest: Schema.String,
  status: Schema.Literals(["admitted", "contested", "quarantined"]),
  subjectId: Schema.String,
  targetTypeId: objectTypeIdSchema,
});
export type AdmissionReceipt = typeof admissionReceiptSchema.Type;

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
