import { createHash } from "node:crypto";

import { maximumWorkerCompletionImages } from "@agent/subagents/browser-agent/lib/completion";
import { readReadyBrowserImageArtifact } from "@db/services/browser-images";
import { maximumBrowserImageBytes } from "@shared/browser/artifact";
import { env } from "@shared/environment";
import type { AccessScope } from "@shared/identity/access-scope";
import { get } from "@vercel/blob";

import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "./markdown";

interface LinqImageArtifactFile {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
}

export async function prepareLinqImageArtifactDelivery(
  message: string,
  input: {
    readonly rootSessionId: string;
    readonly scope: AccessScope;
    readonly signal?: AbortSignal;
  }
) {
  const references = extractImageArtifactMarkdownReferences(message);

  if (references.length === 0) {
    return { failedArtifactIds: [], files: [], text: message };
  }

  const selected = references.slice(0, maximumWorkerCompletionImages);

  const loaded = await Promise.all(
    selected.map(async (reference) => ({
      image: await readLinqImageArtifact(input.scope, reference.id, {
        rootSessionId: input.rootSessionId,
        signal: input.signal,
      }).catch(() => undefined),
      reference,
    }))
  );

  const failedArtifactIds = [
    ...loaded
      .filter((item) => item.image === undefined)
      .map((item) => item.reference.id),
    ...references
      .slice(maximumWorkerCompletionImages)
      .map((reference) => reference.id),
  ];

  const files = loaded.flatMap(({ image }) =>
    image
      ? [
          {
            data: Buffer.from(image.bytes),
            filename: image.filename,
            mimeType: image.mediaType,
          } satisfies LinqImageArtifactFile,
        ]
      : []
  );

  return {
    failedArtifactIds,
    files,
    text: stripImageArtifactMarkdownReferences(message),
  };
}

function artifactHasDeliveryFields<
  T extends {
    readonly byteSize?: number | null;
    readonly contentHash?: string | null;
    readonly filename?: string | null;
    readonly mediaType?: string | null;
    readonly storagePathname: string;
    readonly id: string;
  },
>(
  artifact: T | null | undefined
): artifact is T & {
  readonly byteSize: number;
  readonly contentHash: string;
  readonly filename: string;
  readonly mediaType: string;
} {
  return Boolean(
    artifact &&
    artifact.byteSize &&
    artifact.contentHash &&
    artifact.filename &&
    artifact.mediaType
  );
}

function blobStorageConfigured() {
  return Boolean(env.BLOB_STORE_ID) || Boolean(env.BLOB_READ_WRITE_TOKEN);
}

type BlobGetResult = NonNullable<Awaited<ReturnType<typeof get>>>;

function blobMatchesArtifact(
  result: BlobGetResult | null,
  artifact: {
    readonly byteSize: number;
    readonly mediaType: string;
  }
): result is Extract<BlobGetResult, { statusCode: 200 }> {
  return Boolean(
    result &&
      result.statusCode === 200 &&
      result.blob.size === artifact.byteSize &&
      result.blob.contentType === artifact.mediaType &&
      result.stream
  );
}

async function readStreamChunksBounded(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    /* oxlint-disable eslint/no-await-in-loop -- Blob response chunks form an ordered stream. */
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      total += value.byteLength;

      if (total > maximumBytes) return undefined;
      chunks.push(value);
    }
    /* oxlint-enable eslint/no-await-in-loop */
  } finally {
    reader.releaseLock();
  }

  return { chunks, total };
}

function concatUint8Chunks(chunks: readonly Uint8Array[], total: number) {
  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

async function readLinqImageArtifact(
  scope: AccessScope,
  artifactId: string,
  options: { readonly rootSessionId: string; readonly signal?: AbortSignal }
) {
  const artifact = await readReadyBrowserImageArtifact(scope, artifactId, {
    rootSessionId: options.rootSessionId,
  });

  if (!artifactHasDeliveryFields(artifact)) return undefined;

  if (!blobStorageConfigured()) return undefined;

  const result = await get(artifact.storagePathname, {
    access: "private",
    abortSignal: options.signal,
  });

  if (!blobMatchesArtifact(result, artifact)) return undefined;

  const streamed = await readStreamChunksBounded(
    result.stream,
    maximumBrowserImageBytes
  );

  if (!streamed) return undefined;

  const bytes = concatUint8Chunks(streamed.chunks, streamed.total);

  if (createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash)
    return undefined;

  return {
    bytes,
    filename: artifact.filename,
    id: artifact.id,
    mediaType: artifact.mediaType,
  };
}
