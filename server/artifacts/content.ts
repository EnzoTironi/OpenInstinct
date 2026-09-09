import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import {
  ArtifactError,
  ArtifactMetadataSchema,
  type ArtifactRow,
} from "./model";

export const artifactDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export const verifiedArtifact = Effect.fn("verifiedArtifact")(function* (
  row: ArtifactRow
) {
  if (row.deleted) return yield* new ArtifactError({ reason: "deleted" });
  if (
    !row.content ||
    row.content.byteLength !== row.byteLength ||
    artifactDigest(row.content) !== row.sha256
  )
    return yield* new ArtifactError({ reason: "corrupt" });
  if ((row.derivedText === null) !== (row.derivedKind === null))
    return yield* new ArtifactError({ reason: "corrupt" });
  const metadata = yield* Schema.decodeUnknownEffect(ArtifactMetadataSchema)(
    row
  );
  return {
    metadata,
    bytes: row.content,
    derived:
      row.derivedText !== null && row.derivedKind !== null
        ? { text: row.derivedText, kind: row.derivedKind }
        : null,
  };
});
