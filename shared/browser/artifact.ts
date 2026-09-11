import { z } from "zod";

export const maximumBrowserImageBytes = 8 * 1024 * 1024;

export const browserImageMediaTypeSchema = z.enum([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const browserImageSourceKinds = [
  "element",
  "full_page",
  "image_resource",
  "viewport",
] as const;

export const browserImageSourceKindSchema = z.enum(browserImageSourceKinds);

export const browserImageArtifactReferenceSchema = z
  .object({
    byteSize: z.number().int().positive().max(maximumBrowserImageBytes),
    filename: z.string().trim().min(1).max(180),
    id: z.uuid(),
    label: z.string().trim().min(1).max(200),
    mediaType: browserImageMediaTypeSchema,
    url: z.string(),
  })
  .refine((artifact) => artifact.url === browserImageArtifactUrl(artifact.id), {
    message: "Artifact URL must match its id.",
    path: ["url"],
  });

export type BrowserImageArtifactReference = z.infer<
  typeof browserImageArtifactReferenceSchema
>;

export function browserImageArtifactUrl(id: string) {
  return `/artifacts/${encodeURIComponent(z.uuid().parse(id))}`;
}

export function isBrowserImageArtifactUrl(value: string) {
  const parsed = /^\/artifacts\/([^/]+)$/u.exec(value);

  if (!parsed?.[1]) return false;

  return z.uuid().safeParse(decodeURIComponent(parsed[1])).success;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const jpegSignature = [0xff, 0xd8, 0xff] as const;

function bytesMatch(
  bytes: Uint8Array,
  offset: number,
  signature: readonly number[]
) {
  if (bytes.length < offset + signature.length) return false;

  return signature.every((value, index) => bytes[offset + index] === value);
}

function asciiSlice(bytes: Uint8Array, start: number, end: number) {
  return new TextDecoder("ascii").decode(bytes.subarray(start, end));
}

function isPngBytes(bytes: Uint8Array) {
  return bytesMatch(bytes, 0, pngSignature);
}

function isJpegBytes(bytes: Uint8Array) {
  return bytesMatch(bytes, 0, jpegSignature);
}

function isGifBytes(bytes: Uint8Array) {
  if (bytes.length < 6) return false;
  const signature = asciiSlice(bytes, 0, 6);

  return signature === "GIF87a" || signature === "GIF89a";
}

function isWebpBytes(bytes: Uint8Array) {
  if (bytes.length < 12) return false;

  return (
    asciiSlice(bytes, 0, 4) === "RIFF" && asciiSlice(bytes, 8, 12) === "WEBP"
  );
}

export function sniffBrowserImageMediaType(bytes: Uint8Array) {
  if (isPngBytes(bytes)) return "image/png" as const;

  if (isJpegBytes(bytes)) return "image/jpeg" as const;

  if (isGifBytes(bytes)) return "image/gif" as const;

  if (isWebpBytes(bytes)) return "image/webp" as const;

  return undefined;
}
