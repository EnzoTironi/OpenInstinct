import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { Clock, Effect, Schema } from "effect";

import { actionHostBindingSchema, type ActionHostBinding } from "./catalog";
import { generatePrefixedId } from "./types";

export const SOURCE_TRANSFORM_VERSION = "src-norm.1.0.0";
export const MAX_INGEST_BYTES = 10 * 1024 * 1024;

const requiredId = Schema.String.check(Schema.isMinLength(1));
const ingestParseOptions = { onExcessProperty: "error" } as const;

export const sourceClassSchema = Schema.Literals(["distilled", "raw"]);
export type SourceClass = typeof sourceClassSchema.Type;

export const ingestAdmissionSchema = Schema.Struct({
  mediaType: requiredId,
  sourceClass: sourceClassSchema,
});
export type IngestAdmission = typeof ingestAdmissionSchema.Type;

export const instructionAuthoritySchema = Schema.Literal("none");
export type InstructionAuthority = typeof instructionAuthoritySchema.Type;

export const sourceReferenceSchema = Schema.Struct({
  blobId: requiredId,
  digest: requiredId,
  id: requiredId,
  instructionAuthority: instructionAuthoritySchema,
  mediaType: requiredId,
  normalizedText: Schema.String,
  sourceClass: sourceClassSchema,
  transformVersion: Schema.Literal(SOURCE_TRANSFORM_VERSION),
  userId: requiredId,
  workspaceId: requiredId,
});
export type SourceReference = typeof sourceReferenceSchema.Type;

export const blobReceiptSchema = Schema.Struct({
  digest: requiredId,
  id: requiredId,
  mediaType: requiredId,
  size: Schema.Number,
});
export type BlobReceipt = typeof blobReceiptSchema.Type;

export type LocatorClass =
  | { readonly kind: "fetch_required" }
  | { readonly kind: "invalid_locator" }
  | { readonly kind: "unsafe_locator" };

export type CoverageMap =
  | {
      readonly archiveId: string;
      readonly coveredSourceIds: readonly string[];
      readonly kind: "complete";
    }
  | {
      readonly archiveId: string;
      readonly coveredSourceIds: readonly string[];
      readonly kind: "partial";
      readonly uncoveredSourceIds: readonly [string, ...string[]];
    };

export type IngestResult =
  | { readonly kind: "admitted"; readonly source: SourceReference }
  | {
      readonly kind: "isolated";
      readonly blobId: string;
      readonly reason: "malformed";
    };

export type CoverageEvidenceStatus = "available" | "missing";

export class IngestRejected extends Schema.TaggedError<IngestRejected>()(
  "IngestRejected",
  {
    reason: Schema.Literals([
      "coverage_overclaim",
      "fetch_required",
      "invalid_locator",
      "invalid_parameter",
      "invalid_scope",
      "malformed",
      "missing_blob",
      "not_found",
      "too_large",
      "unsupported_media",
      "unsafe_locator",
    ]),
  }
) {}

interface StoredBlob {
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly id: string;
  readonly mediaType: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface IngestState {
  readonly archives: Map<string, CoverageMap>;
  readonly blobs: Map<string, StoredBlob>;
  readonly digestKeys: Map<string, string>;
  readonly isolated: Map<string, true>;
  readonly references: Map<string, SourceReference>;
  readonly referenceByBlob: Map<string, string>;
}

const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);

function reject(reason: IngestRejected["reason"]) {
  return new IngestRejected({ reason });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseMediaType(value: string): string {
  const [raw] = value.split(";");
  return (raw ?? "").trim().toLowerCase();
}

function isSupportedTextMedia(mediaType: string): boolean {
  switch (mediaType) {
    case "text/html":
    case "text/markdown":
    case "text/plain":
      return true;
    default:
      return false;
  }
}

function ipv4Octets(
  host: string
): readonly [number, number, number, number] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return undefined;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) {
      return undefined;
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return undefined;
    }
    octets.push(value);
  }
  const [a, b, c, d] = octets;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    return undefined;
  }
  return [a, b, c, d];
}

function isPrivateIPv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (!octets) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIPv4(normalized.slice("::ffff:".length));
  }
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  const family = isIP(host);
  if (family === 4) {
    return isPrivateIPv4(host);
  }
  if (family === 6) {
    return isPrivateIPv6(host);
  }
  return false;
}

/**
 * Classify a locator without fetching. HTTP(S) public URLs still require a
 * separate host-authorized fetch; this catalog never retrieves bytes itself.
 */
export function classifyLocator(href: string): LocatorClass {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return { kind: "invalid_locator" };
  }
  switch (parsed.protocol) {
    case "http:":
    case "https:":
      break;
    default:
      return { kind: "unsafe_locator" };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { kind: "unsafe_locator" };
  }
  return { kind: "fetch_required" };
}

export const decodeIngestAdmission = Effect.fn("decodeIngestAdmission")(
  function* (encoded: Schema.Json) {
    return yield* Schema.decodeUnknownEffect(ingestAdmissionSchema, {
      ...ingestParseOptions,
    })(encoded).pipe(Effect.mapError(() => reject("invalid_parameter")));
  }
);

function decodeNumericEntity(value: string, radix: number): string {
  const code = Number.parseInt(value, radix);
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return "";
  }
  return String.fromCodePoint(code);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x[0-9a-f]+;/giu, (entity) =>
      decodeNumericEntity(entity.slice(3, -1), 16)
    )
    .replace(/&#\d+;/gu, (entity) =>
      decodeNumericEntity(entity.slice(2, -1), 10)
    )
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&amp;/giu, "&");
}

function stripHtml(html: string): string {
  const withoutBlocks = html.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu,
    " "
  );
  return decodeEntities(withoutBlocks.replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,;:!?])/gu, "$1");
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function normalizeDecodedText(mediaType: string, decoded: string): string {
  const unified = decoded.replace(/\r\n?/gu, "\n");
  const stripped = mediaType === "text/html" ? stripHtml(unified) : unified;
  return stripped.normalize("NFC").trim();
}

const requireHost = Effect.fn("InMemorySourceIngest.requireHost")(function* (
  scope: ActionHostBinding
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
});

const putBlobImpl = Effect.fn("InMemorySourceIngest.putBlob")(function* (
  state: IngestState,
  scope: ActionHostBinding,
  bytes: Uint8Array,
  mediaType: string
) {
  const host = yield* requireHost(scope);
  if (bytes.length === 0 || bytes.length > MAX_INGEST_BYTES) {
    return yield* reject("too_large");
  }
  const normalizedMedia = baseMediaType(mediaType);
  if (!isSupportedTextMedia(normalizedMedia)) {
    return yield* reject("unsupported_media");
  }
  const digest = digestBytes(bytes);
  const digestKey = `${scopeKey(host)}\0${digest}`;
  const existingId = state.digestKeys.get(digestKey);
  if (existingId) {
    const existing = state.blobs.get(recordKey(host, existingId));
    if (!existing) {
      return yield* reject("missing_blob");
    }
    const receipt: BlobReceipt = {
      digest: existing.digest,
      id: existing.id,
      mediaType: existing.mediaType,
      size: existing.bytes.length,
    };
    return receipt;
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  const blob: StoredBlob = {
    bytes: cloneBytes(bytes),
    digest,
    id: generatePrefixedId("blob", recordedAt),
    mediaType: normalizedMedia,
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
  state.blobs.set(recordKey(host, blob.id), blob);
  state.digestKeys.set(digestKey, blob.id);
  const receipt: BlobReceipt = {
    digest: blob.digest,
    id: blob.id,
    mediaType: blob.mediaType,
    size: blob.bytes.length,
  };
  return receipt;
});

const commitReferenceImpl = Effect.fn("InMemorySourceIngest.commitReference")(
  function* (
    state: IngestState,
    scope: ActionHostBinding,
    blobId: string,
    sourceClass: SourceClass
  ) {
    const host = yield* requireHost(scope);
    const blobKey = recordKey(host, blobId);
    if (state.isolated.has(blobKey)) {
      return yield* reject("malformed");
    }
    const existingId = state.referenceByBlob.get(blobKey);
    if (existingId) {
      const existing = state.references.get(recordKey(host, existingId));
      if (!existing) {
        return yield* reject("not_found");
      }
      if (existing.sourceClass !== sourceClass) {
        return yield* reject("invalid_parameter");
      }
      return existing;
    }
    const blob = state.blobs.get(blobKey);
    if (!blob) {
      return yield* reject("missing_blob");
    }
    const decoded = decodeUtf8(blob.bytes);
    if (decoded === undefined) {
      state.isolated.set(blobKey, true);
      return yield* reject("malformed");
    }
    const normalizedText = normalizeDecodedText(blob.mediaType, decoded);
    const source: SourceReference = {
      blobId: blob.id,
      digest: blob.digest,
      id: generatePrefixedId("doc", yield* Clock.currentTimeMillis),
      instructionAuthority: "none",
      mediaType: blob.mediaType,
      normalizedText,
      sourceClass,
      transformVersion: SOURCE_TRANSFORM_VERSION,
      userId: host.userId,
      workspaceId: host.workspaceId,
    };
    state.references.set(recordKey(host, source.id), source);
    state.referenceByBlob.set(blobKey, source.id);
    return source;
  }
);

const ingestBytesImpl = Effect.fn("InMemorySourceIngest.ingestBytes")(
  function* (
    state: IngestState,
    scope: ActionHostBinding,
    bytes: Uint8Array,
    encodedAdmission: Schema.Json
  ) {
    const admission = yield* decodeIngestAdmission(encodedAdmission);
    const blob = yield* putBlobImpl(state, scope, bytes, admission.mediaType);
    const decoded = decodeUtf8(bytes);
    if (decoded === undefined) {
      const host = yield* requireHost(scope);
      state.isolated.set(recordKey(host, blob.id), true);
      const isolated: IngestResult = {
        blobId: blob.id,
        kind: "isolated",
        reason: "malformed",
      };
      return isolated;
    }
    const source = yield* commitReferenceImpl(
      state,
      scope,
      blob.id,
      admission.sourceClass
    );
    const admitted: IngestResult = { kind: "admitted", source };
    return admitted;
  }
);

const cleanupOrphansImpl = Effect.fn("InMemorySourceIngest.cleanupOrphans")(
  function* (state: IngestState, scope: ActionHostBinding) {
    const host = yield* requireHost(scope);
    const prefix = `${scopeKey(host)}\0`;
    const removed: string[] = [];
    for (const [key, blob] of state.blobs) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      if (state.referenceByBlob.has(key) || state.isolated.has(key)) {
        continue;
      }
      state.blobs.delete(key);
      state.digestKeys.delete(`${scopeKey(host)}\0${blob.digest}`);
      removed.push(blob.id);
    }
    return removed;
  }
);

const getSourceImpl = Effect.fn("InMemorySourceIngest.getSource")(function* (
  state: IngestState,
  scope: ActionHostBinding,
  sourceId: string
) {
  const host = yield* requireHost(scope);
  const source = state.references.get(recordKey(host, sourceId));
  if (!source) {
    return yield* reject("not_found");
  }
  const blob = state.blobs.get(recordKey(host, source.blobId));
  if (!blob) {
    return yield* reject("missing_blob");
  }
  return source;
});

const getBlobImpl = Effect.fn("InMemorySourceIngest.getBlob")(function* (
  state: IngestState,
  scope: ActionHostBinding,
  blobId: string
) {
  const host = yield* requireHost(scope);
  const blob = state.blobs.get(recordKey(host, blobId));
  if (!blob) {
    return yield* reject("not_found");
  }
  return cloneBytes(blob.bytes);
});

const readSpanImpl = Effect.fn("InMemorySourceIngest.readSpan")(function* (
  state: IngestState,
  scope: ActionHostBinding,
  sourceId: string,
  start: number,
  end: number
) {
  const source = yield* getSourceImpl(state, scope, sourceId);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > source.normalizedText.length ||
    start >= end
  ) {
    return yield* reject("invalid_parameter");
  }
  return source.normalizedText.slice(start, end);
});

const bindArchiveImpl = Effect.fn("InMemorySourceIngest.bindArchive")(
  function* (
    state: IngestState,
    scope: ActionHostBinding,
    archiveId: string,
    sourceIds: readonly string[],
    coveredSourceIds: readonly string[]
  ) {
    const host = yield* requireHost(scope);
    if (archiveId.trim() === "" || sourceIds.length === 0) {
      return yield* reject("invalid_parameter");
    }
    const unique = new Set(sourceIds);
    if (unique.size !== sourceIds.length) {
      return yield* reject("invalid_parameter");
    }
    for (const sourceId of sourceIds) {
      const source = yield* getSourceImpl(state, scope, sourceId);
      if (source.sourceClass !== "raw") {
        return yield* reject("invalid_parameter");
      }
    }
    const sourceSet = new Set(sourceIds);
    const coveredUnique = new Set(coveredSourceIds);
    if (coveredUnique.size !== coveredSourceIds.length) {
      return yield* reject("invalid_parameter");
    }
    for (const coveredId of coveredSourceIds) {
      if (!sourceSet.has(coveredId)) {
        return yield* reject("invalid_parameter");
      }
    }
    const uncovered = sourceIds.filter((id) => !coveredUnique.has(id));
    const [firstUncovered, ...restUncovered] = uncovered;
    const map: CoverageMap =
      firstUncovered === undefined
        ? {
            archiveId,
            coveredSourceIds: [...coveredSourceIds],
            kind: "complete",
          }
        : {
            archiveId,
            coveredSourceIds: [...coveredSourceIds],
            kind: "partial",
            uncoveredSourceIds: [firstUncovered, ...restUncovered],
          };
    state.archives.set(recordKey(host, archiveId), map);
    return map;
  }
);

const coverageForArchiveImpl = Effect.fn(
  "InMemorySourceIngest.coverageForArchive"
)(function* (state: IngestState, scope: ActionHostBinding, archiveId: string) {
  const host = yield* requireHost(scope);
  const map = state.archives.get(recordKey(host, archiveId));
  if (!map) {
    return yield* reject("not_found");
  }
  return map;
});

const searchCoveredImpl = Effect.fn("InMemorySourceIngest.searchCovered")(
  function* (
    state: IngestState,
    scope: ActionHostBinding,
    archiveId: string,
    needle: string
  ) {
    if (needle.trim() === "") {
      return yield* reject("invalid_parameter");
    }
    const map = yield* coverageForArchiveImpl(state, scope, archiveId);
    const hits: string[] = [];
    for (const sourceId of map.coveredSourceIds) {
      const source = yield* getSourceImpl(state, scope, sourceId);
      if (source.normalizedText.includes(needle)) {
        hits.push(source.id);
      }
    }
    return hits;
  }
);

const coverageEvidenceImpl = Effect.fn("InMemorySourceIngest.coverageEvidence")(
  function* (
    state: IngestState,
    scope: ActionHostBinding,
    archiveId: string,
    sourceId: string
  ) {
    const map = yield* coverageForArchiveImpl(state, scope, archiveId);
    if (map.coveredSourceIds.includes(sourceId)) {
      const status: CoverageEvidenceStatus = "available";
      return status;
    }
    switch (map.kind) {
      case "complete":
        return yield* reject("not_found");
      case "partial":
        if (map.uncoveredSourceIds.includes(sourceId)) {
          const status: CoverageEvidenceStatus = "missing";
          return status;
        }
        return yield* reject("not_found");
      default: {
        const exhaustive: never = map;
        return exhaustive;
      }
    }
  }
);

export function coverageIsExhaustive(map: CoverageMap): boolean {
  switch (map.kind) {
    case "complete":
      return true;
    case "partial":
      return false;
    default: {
      const exhaustive: never = map;
      return exhaustive;
    }
  }
}

export const claimExhaustiveSearch = Effect.fn("claimExhaustiveSearch")(
  function* (map: CoverageMap) {
    if (!coverageIsExhaustive(map)) {
      return yield* reject("coverage_overclaim");
    }
    return map;
  }
);

export const rejectUnauthorizedLocator = Effect.fn("rejectUnauthorizedLocator")(
  function* (href: string) {
    const classified = classifyLocator(href);
    switch (classified.kind) {
      case "fetch_required":
        return yield* reject("fetch_required");
      case "invalid_locator":
        return yield* reject("invalid_locator");
      case "unsafe_locator":
        return yield* reject("unsafe_locator");
      default: {
        const exhaustive: never = classified;
        return exhaustive;
      }
    }
  }
);

/**
 * Host-scoped blob catalog: bytes are stored before a source reference is
 * committed. URLs are never fetched here. Isolated malformed blobs are not
 * searchable sources. Distilled memory is a distinct class from raw archives.
 */
export class InMemorySourceIngest {
  readonly #state: IngestState = {
    archives: new Map(),
    blobs: new Map(),
    digestKeys: new Map(),
    isolated: new Map(),
    referenceByBlob: new Map(),
    references: new Map(),
  };

  putBlob(scope: ActionHostBinding, bytes: Uint8Array, mediaType: string) {
    return putBlobImpl(this.#state, scope, bytes, mediaType);
  }

  commitReference(
    scope: ActionHostBinding,
    blobId: string,
    sourceClass: SourceClass
  ) {
    return commitReferenceImpl(this.#state, scope, blobId, sourceClass);
  }

  ingestBytes(
    scope: ActionHostBinding,
    bytes: Uint8Array,
    encodedAdmission: Schema.Json
  ) {
    return ingestBytesImpl(this.#state, scope, bytes, encodedAdmission);
  }

  cleanupOrphans(scope: ActionHostBinding) {
    return cleanupOrphansImpl(this.#state, scope);
  }

  getSource(scope: ActionHostBinding, sourceId: string) {
    return getSourceImpl(this.#state, scope, sourceId);
  }

  getBlob(scope: ActionHostBinding, blobId: string) {
    return getBlobImpl(this.#state, scope, blobId);
  }

  readSpan(
    scope: ActionHostBinding,
    sourceId: string,
    start: number,
    end: number
  ) {
    return readSpanImpl(this.#state, scope, sourceId, start, end);
  }

  bindArchive(
    scope: ActionHostBinding,
    archiveId: string,
    sourceIds: readonly string[],
    coveredSourceIds: readonly string[]
  ) {
    return bindArchiveImpl(
      this.#state,
      scope,
      archiveId,
      sourceIds,
      coveredSourceIds
    );
  }

  coverageForArchive(scope: ActionHostBinding, archiveId: string) {
    return coverageForArchiveImpl(this.#state, scope, archiveId);
  }

  searchCovered(scope: ActionHostBinding, archiveId: string, needle: string) {
    return searchCoveredImpl(this.#state, scope, archiveId, needle);
  }

  coverageEvidence(
    scope: ActionHostBinding,
    archiveId: string,
    sourceId: string
  ) {
    return coverageEvidenceImpl(this.#state, scope, archiveId, sourceId);
  }
}
