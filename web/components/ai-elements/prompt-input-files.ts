import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";

export interface PromptInputFileError {
  code: "max_files" | "max_file_size" | "accept";
  message: string;
}

export type PromptInputOnError = (err: PromptInputFileError) => void;

export function fileMatchesAccept(
  file: File,
  accept: string | undefined
): boolean {
  if (!accept || accept.trim() === "") {
    return true;
  }

  const patterns = accept
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return patterns.some((pattern) => patternMatchesFile(pattern, file));
}

function patternMatchesFile(pattern: string, file: File): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);

    return file.type.startsWith(prefix);
  }

  return file.type === pattern;
}

function withinMaxSize(file: File, maxFileSize: number | undefined): boolean {
  if (!maxFileSize) return true;

  return file.size <= maxFileSize;
}

export function filterIncomingFiles(
  fileList: File[] | FileList,
  accept: string | undefined,
  maxFileSize: number | undefined,
  onError: PromptInputOnError | undefined
): File[] {
  const incoming = [...fileList];
  const accepted = incoming.filter((file) => fileMatchesAccept(file, accept));

  if (incoming.length > 0 && accepted.length === 0) {
    onError?.({
      code: "accept",
      message: "No files match the accepted types.",
    });

    return [];
  }

  const sized = accepted.filter((file) => withinMaxSize(file, maxFileSize));

  if (accepted.length > 0 && sized.length === 0) {
    onError?.({
      code: "max_file_size",
      message: "All files exceed the maximum size.",
    });

    return [];
  }

  return sized;
}

export function capacityForMaxFiles(
  maxFiles: number | undefined,
  currentCount: number
): number | undefined {
  const maximum = z.number().safeParse(maxFiles);

  if (!maximum.success) return undefined;

  return Math.max(0, maximum.data - currentCount);
}

export function capFilesToCapacity(
  sized: File[],
  capacity: number | undefined,
  onError: PromptInputOnError | undefined
): File[] {
  if (capacity === undefined) return sized;

  if (sized.length > capacity) {
    onError?.({
      code: "max_files",
      message: "Too many files. Some were not added.",
    });
  }

  return sized.slice(0, capacity);
}

export function filesToAttachmentParts(
  files: File[]
): (FileUIPart & { id: string })[] {
  return files.map((file) => ({
    filename: file.name,
    id: nanoid(),
    mediaType: file.type,
    type: "file" as const,
    url: URL.createObjectURL(file),
  }));
}

export function revokeAttachmentUrls(files: readonly { url?: string }[]): void {
  for (const file of files) {
    if (file.url) {
      URL.revokeObjectURL(file.url);
    }
  }
}

export async function convertBlobUrlToDataUrl(
  url: string
): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();

    return await readBlobAsDataUrl(blob);
  } catch {
    return null;
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener(
      "loadend",
      () => {
        const result = reader.result;
        resolve(result instanceof ArrayBuffer ? null : result);
      },
      { once: true }
    );
    reader.addEventListener(
      "error",
      () => {
        resolve(null);
      },
      { once: true }
    );
    reader.readAsDataURL(blob);
  });
}

export async function convertAttachmentFiles(
  files: (FileUIPart & { id: string })[]
): Promise<FileUIPart[]> {
  return Promise.all(files.map(convertOneAttachment));
}

async function convertOneAttachment({
  id: _id,
  ...item
}: FileUIPart & { id: string }): Promise<FileUIPart> {
  if (!item.url.startsWith("blob:")) {
    return item;
  }

  const dataUrl = await convertBlobUrlToDataUrl(item.url);

  return {
    ...item,
    url: dataUrl ?? item.url,
  };
}

export const dragDataTransferSchema = z.custom<DataTransfer>(
  (value) => value !== null && value !== undefined
);

export function handleFileDragOver(event: DragEvent): void {
  const dataTransfer = dragDataTransferSchema.safeParse(event.dataTransfer);

  if (!dataTransfer.success) return;

  if (dataTransfer.data.types.includes("Files")) {
    event.preventDefault();
  }
}

export function handleFileDrop(
  event: DragEvent,
  add: (files: FileList) => void
): void {
  const dataTransfer = dragDataTransferSchema.safeParse(event.dataTransfer);

  if (!dataTransfer.success) return;

  if (dataTransfer.data.types.includes("Files")) {
    event.preventDefault();
  }

  if (dataTransfer.data.files.length > 0) {
    add(dataTransfer.data.files);
  }
}
