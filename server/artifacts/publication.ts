import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { artifactDigest } from "./content";
import { artifactLimits } from "./model";

const parseOptions = { onExcessProperty: "error" } as const;
const requiredId = Schema.String.check(Schema.isMinLength(1));
const mediaTypeSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128)
);
const sha256Schema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

const constraintsSchema = Schema.Struct({
  maxBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: artifactLimits.bytes })
  ),
  maxPages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  mediaTypes: Schema.Array(mediaTypeSchema).check(Schema.isMinLength(1)),
});

const destinationMetaSchema = Schema.Struct({
  constraints: constraintsSchema,
  filename: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
    Schema.isTrimmed()
  ),
  mediaType: mediaTypeSchema,
  pageCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  workspaceId: requiredId,
});

const sendBindSchema = Schema.Struct({
  payloadSha256: sha256Schema,
  publishedSha256: sha256Schema,
});

type ArtifactProof =
  | { kind: "destination_accepted"; sha256: string }
  | { kind: "published"; revisionId: string; sha256: string }
  | { kind: "send"; sha256: string }
  | { kind: "ui_update" }
  | { kind: "upload"; sha256: string }
  | { kind: "working_write"; workingId: string };

interface WorkingArtifact {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
  pageCount: number;
  workspaceId: string;
}

interface PublishedArtifact extends WorkingArtifact {
  revoked: boolean;
  sha256: string;
}

/**
 * Destination checks and an immutable published revision.
 * Working-tree bytes are a different proof from publication, upload, and send.
 */
export function acceptDestinationArtifact(
  bytes: Uint8Array,
  encoded: Schema.Json
) {
  const meta = Schema.decodeUnknownSync(
    destinationMetaSchema,
    parseOptions
  )(encoded);
  if (bytes.byteLength < 1 || bytes.byteLength > meta.constraints.maxBytes) {
    return deny("too_large");
  }
  if (!meta.constraints.mediaTypes.includes(meta.mediaType)) {
    return deny("media_type");
  }
  if (meta.pageCount > meta.constraints.maxPages) {
    return deny("page_limit");
  }
  return {
    kind: "accepted" as const,
    bytes,
    filename: meta.filename,
    mediaType: meta.mediaType,
    pageCount: meta.pageCount,
    sha256: artifactDigest(bytes),
    workspaceId: meta.workspaceId,
  };
}

export function isDomainSuccess(proof: ArtifactProof) {
  switch (proof.kind) {
    case "destination_accepted":
      return true;
    case "published":
    case "send":
    case "ui_update":
    case "upload":
    case "working_write":
      return false;
    default: {
      const exhaustive: never = proof;
      return exhaustive;
    }
  }
}

export function bindPublishedSend(encoded: Schema.Json) {
  const bind = Schema.decodeUnknownSync(sendBindSchema, parseOptions)(encoded);
  if (bind.payloadSha256 !== bind.publishedSha256) {
    return deny("hash_mismatch");
  }
  return { kind: "send" as const, sha256: bind.publishedSha256 };
}

export class ArtifactPublication {
  readonly #published = new Map<string, PublishedArtifact>();
  readonly #working = new Map<string, WorkingArtifact>();

  writeWorking(bytes: Uint8Array, encoded: Schema.Json) {
    const accepted = acceptDestinationArtifact(bytes, encoded);
    if (accepted.kind !== "accepted") {
      return accepted;
    }
    const workingId = randomUUID();
    this.#working.set(workingId, {
      bytes: Uint8Array.from(accepted.bytes),
      filename: accepted.filename,
      mediaType: accepted.mediaType,
      pageCount: accepted.pageCount,
      workspaceId: accepted.workspaceId,
    });
    return { kind: "working_write" as const, workingId };
  }

  replaceWorking(workingId: string, bytes: Uint8Array) {
    const current = this.#working.get(workingId);
    if (!current) {
      return deny("not_found");
    }
    current.bytes = Uint8Array.from(bytes);
    return { kind: "working_write" as const, workingId };
  }

  publish(workingId: string, workspaceId: string) {
    const working = this.#working.get(workingId);
    if (!working || working.workspaceId !== workspaceId) {
      return deny("not_found");
    }
    const revisionId = randomUUID();
    const sha256 = artifactDigest(working.bytes);
    this.#published.set(revisionId, {
      bytes: Uint8Array.from(working.bytes),
      filename: working.filename,
      mediaType: working.mediaType,
      pageCount: working.pageCount,
      revoked: false,
      sha256,
      workspaceId: working.workspaceId,
    });
    return { kind: "published" as const, revisionId, sha256 };
  }

  retrieve(revisionId: string, workspaceId: string) {
    const published = this.#published.get(revisionId);
    if (!published || published.workspaceId !== workspaceId) {
      return deny("not_found");
    }
    if (published.revoked) {
      return deny("revoked");
    }
    return {
      kind: "published" as const,
      bytes: Uint8Array.from(published.bytes),
      sha256: published.sha256,
    };
  }

  revoke(revisionId: string, workspaceId: string) {
    const published = this.#published.get(revisionId);
    if (!published || published.workspaceId !== workspaceId) {
      return deny("not_found");
    }
    published.revoked = true;
    return { kind: "revoked" as const, revisionId };
  }
}

function deny(
  reason:
    | "hash_mismatch"
    | "media_type"
    | "not_found"
    | "page_limit"
    | "revoked"
    | "too_large"
) {
  return { kind: "deny" as const, reason };
}
