import { Effect, Schema } from "effect";
import { IdentityId } from "../messaging/model";

export const artifactLimits = {
  bytes: 10 * 1024 * 1024,
  textBytes: 64 * 1024,
} as const;
const reference = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isTrimmed()
);
export const ArtifactId = IdentityId;
const ArtifactHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
const ArtifactText = Schema.String.check(
  Schema.makeFilter(
    (text) =>
      text.isWellFormed() &&
      Buffer.byteLength(text, "utf8") <= artifactLimits.textBytes
  )
);
const ArtifactBytes = Schema.Uint8Array.check(
  Schema.makeFilter(
    (bytes) => bytes.byteLength >= 1 && bytes.byteLength <= artifactLimits.bytes
  )
);
export const ArtifactReferenceSchema = Schema.Struct({
  artifactId: ArtifactId,
  sha256: ArtifactHash,
  filename: reference,
  mediaType: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128)
  ),
  byteLength: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: artifactLimits.bytes })
  ),
});
export type ArtifactReference = typeof ArtifactReferenceSchema.Type;
export const ArtifactMetadataSchema = Schema.Struct({
  ...ArtifactReferenceSchema.fields,
  createdAt: Schema.String,
  sourceEventId: reference,
  sourceMessageId: reference,
  sourceMediaId: reference,
});
const ArtifactDerivedSchema = Schema.Struct({
  text: ArtifactText,
  kind: Schema.Literals(["text", "transcript"]),
});
export const ArtifactRowSchema = Schema.Struct({
  ...ArtifactMetadataSchema.fields,
  ownerUserId: reference,
  workspaceId: reference,
  sourceIdentityId: IdentityId,
  sourceInboxId: IdentityId,
  content: Schema.NullOr(ArtifactBytes),
  derivedText: Schema.NullOr(ArtifactText),
  derivedKind: Schema.NullOr(ArtifactDerivedSchema.fields.kind),
  deleted: Schema.Boolean,
});
export type ArtifactRow = typeof ArtifactRowSchema.Type;
export const ArtifactAccessSchema = Schema.Struct({
  identityId: IdentityId,
  artifactId: ArtifactId,
});
export const ArtifactSourceSchema = Schema.Struct({
  identityId: IdentityId,
  sourceInboxId: IdentityId,
  mediaId: reference,
});
export const ArtifactPutSchema = Schema.Struct({
  ...ArtifactSourceSchema.fields,
  bytes: ArtifactBytes,
});
export const ArtifactListSchema = Schema.Struct({
  identityId: IdentityId,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
});
export const ArtifactDeriveSchema = Schema.Struct({
  ...ArtifactAccessSchema.fields,
  sha256: ArtifactHash,
  ...ArtifactDerivedSchema.fields,
});
export class ArtifactError extends Schema.TaggedError<ArtifactError>()(
  "ArtifactError",
  {
    reason: Schema.Literals([
      "invalid_input",
      "unavailable",
      "not_found",
      "source_invalid",
      "source_conflict",
      "deleted",
      "corrupt",
    ]),
  }
) {}
export const decodeArtifactInput = <S extends Schema.Constraint>(
  schema: S,
  input: S["Type"]
) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input).pipe(
    // Errors expose a category, never file bytes or source payloads.
    Effect.mapError(() => new ArtifactError({ reason: "invalid_input" }))
  );
