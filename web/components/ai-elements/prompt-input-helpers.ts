import { InputGroup } from "@web/components/ui/input-group";
import type { FileUIPart } from "ai";
import { m } from "motion/react";
import { nanoid } from "nanoid";
import { z } from "zod";

export const MotionInputGroup = m.create(InputGroup);

export const promptInputLayoutTransition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1] as const,
};

function resolveFileReaderResult(
  reader: FileReader,
  resolve: (value: string | null) => void
): void {
  const result = reader.result;
  resolve(result instanceof ArrayBuffer ? null : result);
}

export const convertBlobUrlToDataUrl = async (
  url: string
): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener(
        "loadend",
        () => {
          resolveFileReaderResult(reader, resolve);
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
  } catch {
    return null;
  }
};

export const dragDataTransferSchema = z.custom<DataTransfer>(
  (value) => value !== null && value !== undefined
);

export type AttachmentFile = FileUIPart & { id: string };

export function fileToAttachment(file: File): AttachmentFile {
  return {
    filename: file.name,
    id: nanoid(),
    mediaType: file.type,
    type: "file" as const,
    url: URL.createObjectURL(file),
  };
}

export function revokeAttachmentUrl(file: { url?: string }): void {
  if (file.url) {
    URL.revokeObjectURL(file.url);
  }
}

export function revokeAttachmentUrls(files: { url?: string }[]): void {
  for (const file of files) {
    revokeAttachmentUrl(file);
  }
}

export function matchesAcceptPattern(file: File, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);

    return file.type.startsWith(prefix);
  }

  return file.type === pattern;
}

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

  return patterns.some((pattern) => matchesAcceptPattern(file, pattern));
}

export type PromptInputErrorHandler = (err: {
  code: "max_files" | "max_file_size" | "accept";
  message: string;
}) => void;

export function filterAcceptedFiles(
  incoming: File[],
  matchesAccept: (file: File) => boolean,
  onError?: PromptInputErrorHandler
): File[] | null {
  const accepted = incoming.filter(matchesAccept);

  if (incoming.length && accepted.length === 0) {
    onError?.({
      code: "accept",
      message: "No files match the accepted types.",
    });

    return null;
  }

  return accepted;
}

export function filterSizedFiles(
  accepted: File[],
  maxFileSize: number | undefined,
  onError?: PromptInputErrorHandler
): File[] | null {
  const sized = accepted.filter((file) =>
    maxFileSize ? file.size <= maxFileSize : true
  );

  if (accepted.length > 0 && sized.length === 0) {
    onError?.({
      code: "max_file_size",
      message: "All files exceed the maximum size.",
    });

    return null;
  }

  return sized;
}

export function capFilesByCapacity(
  sized: File[],
  capacity: number | undefined,
  onError?: PromptInputErrorHandler
): File[] {
  if (capacity === undefined) {
    return sized;
  }

  if (sized.length > capacity) {
    onError?.({
      code: "max_files",
      message: "Too many files. Some were not added.",
    });
  }

  return sized.slice(0, capacity);
}

export function resolveFileCapacity(
  maxFiles: number | undefined,
  currentCount: number
): number | undefined {
  const maximum = z.number().safeParse(maxFiles);

  if (!maximum.success) {
    return undefined;
  }

  return Math.max(0, maximum.data - currentCount);
}

export function parseFormMessage(form: HTMLFormElement): string {
  const formData = new FormData(form);

  return z.string().catch("").parse(formData.get("message"));
}

export function isBlobUrl(url: string): boolean {
  return url.startsWith("blob:");
}

export async function convertAttachmentForSubmit(
  item: FileUIPart
): Promise<FileUIPart> {
  if (!isBlobUrl(item.url)) {
    return item;
  }

  const dataUrl = await convertBlobUrlToDataUrl(item.url);

  return {
    ...item,
    url: dataUrl ?? item.url,
  };
}

export async function convertAttachmentsForSubmit(
  files: AttachmentFile[]
): Promise<FileUIPart[]> {
  return Promise.all(
    files.map(async ({ id: _id, ...item }) => convertAttachmentForSubmit(item))
  );
}

export function preventFileDragDefault(event: DragEvent): boolean {
  const dataTransfer = dragDataTransferSchema.safeParse(event.dataTransfer);

  if (!dataTransfer.success) {
    return false;
  }

  if (dataTransfer.data.types.includes("Files")) {
    event.preventDefault();
  }

  return true;
}

export function filesFromDragEvent(event: DragEvent): FileList | null {
  const dataTransfer = dragDataTransferSchema.safeParse(event.dataTransfer);

  if (!dataTransfer.success) {
    return null;
  }

  if (dataTransfer.data.types.includes("Files")) {
    event.preventDefault();
  }

  if (dataTransfer.data.files.length === 0) {
    return null;
  }

  return dataTransfer.data.files;
}

export function parseCssLength(value: string): number {
  return Number.parseFloat(value) || 0;
}

export function isVisibleHtmlElement(child: Element): child is HTMLElement {
  return (
    child instanceof HTMLElement && getComputedStyle(child).display !== "none"
  );
}

export function sumVisibleChildrenWidth(
  children: HTMLElement[],
  gap: number
): number {
  const childrenWidth = children.reduce(
    (width, child) => width + child.getBoundingClientRect().width,
    0
  );

  return childrenWidth + Math.max(0, children.length - 1) * gap;
}

export function measureFooterWidth(footer: HTMLElement): number {
  const footerStyle = getComputedStyle(footer);
  const footerChildren = [...footer.children].filter(isVisibleHtmlElement);
  const gap = parseCssLength(footerStyle.columnGap);

  return (
    parseCssLength(footerStyle.paddingLeft) +
    parseCssLength(footerStyle.paddingRight) +
    sumVisibleChildrenWidth(footerChildren, gap)
  );
}

export function copyTextareaFontToMeasurement(
  textarea: HTMLTextAreaElement,
  measurement: HTMLElement
): void {
  const textareaStyle = getComputedStyle(textarea);
  measurement.style.fontFamily = textareaStyle.fontFamily;
  measurement.style.fontSize = textareaStyle.fontSize;
  measurement.style.fontStretch = textareaStyle.fontStretch;
  measurement.style.fontStyle = textareaStyle.fontStyle;
  measurement.style.fontWeight = textareaStyle.fontWeight;
  measurement.style.letterSpacing = textareaStyle.letterSpacing;
  measurement.style.textTransform = textareaStyle.textTransform;
}

export function computeTextareaAvailableWidth(
  inputGroup: HTMLElement,
  footer: HTMLElement,
  textarea: HTMLTextAreaElement
): number {
  const textareaStyle = getComputedStyle(textarea);
  const footerWidth = measureFooterWidth(footer);

  return (
    inputGroup.clientWidth -
    footerWidth -
    parseCssLength(textareaStyle.paddingLeft) -
    parseCssLength(textareaStyle.paddingRight)
  );
}
