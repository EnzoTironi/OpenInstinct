"use client";

import {
  LocalAttachmentsContext,
  LocalReferencedSourcesContext,
  PromptInputLayoutContext,
  useOptionalPromptInputController,
  type AttachmentsContext,
  type PromptInputLayoutValue,
  type ReferencedSourcesContext,
} from "@web/components/ai-elements/prompt-input-context";
import {
  MotionInputGroup,
  capFilesByCapacity,
  convertAttachmentsForSubmit,
  fileToAttachment,
  filesFromDragEvent,
  filterAcceptedFiles,
  filterSizedFiles,
  fileMatchesAccept,
  parseFormMessage,
  preventFileDragDefault,
  promptInputLayoutTransition,
  resolveFileCapacity,
  revokeAttachmentUrl,
  revokeAttachmentUrls,
  type AttachmentFile,
  type PromptInputErrorHandler,
} from "@web/components/ai-elements/prompt-input-helpers";
import { cn } from "@web/components/class-names";
import type { FileUIPart, SourceDocumentUIPart } from "ai";
import { LazyMotion, domMax, useReducedMotion } from "motion/react";
import { nanoid } from "nanoid";
import type {
  ChangeEventHandler,
  Dispatch,
  HTMLAttributes,
  RefObject,
  SetStateAction,
  SubmitEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface PromptInputMessage {
  text: string;
  files: FileUIPart[];
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  accept?: string;
  multiple?: boolean;
  globalDrop?: boolean;
  syncHiddenInput?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  compact?: boolean;
  onError?: PromptInputErrorHandler;
  onSubmit: (
    message: PromptInputMessage,
    event: SubmitEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

function appendLocalAttachments(
  previous: AttachmentFile[],
  capped: File[],
  maxFiles: number | undefined,
  onError?: PromptInputErrorHandler
): AttachmentFile[] {
  const capacity = resolveFileCapacity(maxFiles, previous.length);
  const limited = capFilesByCapacity(capped, capacity, onError);

  return [...previous, ...limited.map(fileToAttachment)];
}

function addLocalFiles(args: {
  fileList: File[] | FileList;
  matchesAccept: (file: File) => boolean;
  maxFiles: number | undefined;
  maxFileSize: number | undefined;
  onError?: PromptInputErrorHandler;
  setItems: Dispatch<SetStateAction<AttachmentFile[]>>;
}): void {
  const incoming = [...args.fileList];

  const accepted = filterAcceptedFiles(
    incoming,
    args.matchesAccept,
    args.onError
  );

  if (!accepted) {
    return;
  }

  const sized = filterSizedFiles(accepted, args.maxFileSize, args.onError);

  if (!sized) {
    return;
  }

  args.setItems((previous) =>
    appendLocalAttachments(previous, sized, args.maxFiles, args.onError)
  );
}

function removeLocalAttachment(
  previous: AttachmentFile[],
  id: string
): AttachmentFile[] {
  const found = previous.find((file) => file.id === id);
  revokeAttachmentUrl(found ?? {});

  return previous.filter((file) => file.id !== id);
}

function addWithProviderValidation(args: {
  fileList: File[] | FileList;
  matchesAccept: (file: File) => boolean;
  maxFiles: number | undefined;
  maxFileSize: number | undefined;
  onError?: PromptInputErrorHandler;
  currentCount: number;
  providerAdd?: (files: File[] | FileList) => void;
}): void {
  const incoming = [...args.fileList];

  const accepted = filterAcceptedFiles(
    incoming,
    args.matchesAccept,
    args.onError
  );

  if (!accepted) {
    return;
  }

  const sized = filterSizedFiles(accepted, args.maxFileSize, args.onError);

  if (!sized) {
    return;
  }

  const capacity = resolveFileCapacity(args.maxFiles, args.currentCount);
  const capped = capFilesByCapacity(sized, capacity, args.onError);

  if (capped.length > 0) {
    args.providerAdd?.(capped);
  }
}

function clearLocalAttachmentItems(
  previous: AttachmentFile[]
): AttachmentFile[] {
  revokeAttachmentUrls(previous);

  return [];
}

function clearAttachmentsState(args: {
  usingProvider: boolean;
  providerClear?: () => void;
  setItems: Dispatch<SetStateAction<AttachmentFile[]>>;
}): void {
  if (args.usingProvider) {
    args.providerClear?.();

    return;
  }

  args.setItems(clearLocalAttachmentItems);
}

function withSourceId(
  source: SourceDocumentUIPart
): SourceDocumentUIPart & { id: string } {
  return Object.assign({}, source, { id: nanoid() });
}

function appendReferencedSources(
  previous: (SourceDocumentUIPart & { id: string })[],
  incoming: SourceDocumentUIPart[] | SourceDocumentUIPart
): (SourceDocumentUIPart & { id: string })[] {
  const array = Array.isArray(incoming) ? incoming : [incoming];

  return [...previous, ...array.map(withSourceId)];
}

function buildRefsCtx(args: {
  referencedSources: (SourceDocumentUIPart & { id: string })[];
  clearReferencedSources: () => void;
  setReferencedSources: Dispatch<
    SetStateAction<(SourceDocumentUIPart & { id: string })[]>
  >;
}): ReferencedSourcesContext {
  return {
    add: (incoming) => {
      args.setReferencedSources((previous) =>
        appendReferencedSources(previous, incoming)
      );
    },
    clear: args.clearReferencedSources,
    remove: (id) => {
      args.setReferencedSources((previous) =>
        previous.filter((source) => source.id !== id)
      );
    },
    sources: args.referencedSources,
  };
}

function resolveSubmitText(args: {
  usingProvider: boolean;
  providerText?: string;
  form: HTMLFormElement;
}): string {
  if (args.usingProvider) {
    return args.providerText ?? "";
  }

  return parseFormMessage(args.form);
}

async function settleSubmitResult(args: {
  result: void | Promise<void>;
  clear: () => void;
  usingProvider: boolean;
  providerClearText?: () => void;
}): Promise<void> {
  if (!(args.result instanceof Promise)) {
    args.clear();

    if (args.usingProvider) {
      args.providerClearText?.();
    }

    return;
  }

  try {
    await args.result;
    args.clear();

    if (args.usingProvider) {
      args.providerClearText?.();
    }
  } catch {
    // Don't clear on error - user may want to retry
  }
}

async function runPromptSubmit(args: {
  event: SubmitEvent<HTMLFormElement>;
  usingProvider: boolean;
  providerText?: string;
  providerClearText?: () => void;
  files: AttachmentFile[];
  onSubmit: PromptInputProps["onSubmit"];
  clear: () => void;
}): Promise<void> {
  args.event.preventDefault();

  const form = args.event.currentTarget;

  const text = resolveSubmitText({
    usingProvider: args.usingProvider,
    providerText: args.providerText,
    form,
  });

  if (!args.usingProvider) {
    form.reset();
  }

  try {
    const convertedFiles = await convertAttachmentsForSubmit(args.files);
    const result = args.onSubmit({ files: convertedFiles, text }, args.event);

    await settleSubmitResult({
      result,
      clear: args.clear,
      usingProvider: args.usingProvider,
      providerClearText: args.providerClearText,
    });
  } catch {
    // Don't clear on error - user may want to retry
  }
}

function buildLayoutValue(args: {
  animateLayout: boolean;
  compact: boolean;
  expanded: boolean;
  setTextareaExpanded: (expanded: boolean) => void;
}): PromptInputLayoutValue {
  return {
    animateLayout: args.animateLayout,
    compact: args.compact,
    expanded: args.expanded,
    setTextareaExpanded: args.setTextareaExpanded,
  };
}

function resolveFiles(
  usingProvider: boolean,
  providerFiles: AttachmentFile[] | undefined,
  items: AttachmentFile[]
): AttachmentFile[] {
  if (usingProvider && providerFiles) {
    return providerFiles;
  }

  return items;
}

function isExpanded(args: {
  compact: boolean;
  textareaExpanded: boolean;
  filesLength: number;
  referencedSourcesLength: number;
}): boolean {
  if (!args.compact) {
    return false;
  }

  return (
    args.textareaExpanded ||
    args.filesLength > 0 ||
    args.referencedSourcesLength > 0
  );
}

function compactInputGroupClassName(
  compact: boolean,
  expanded: boolean
): string | false {
  if (!compact) {
    return false;
  }

  if (expanded) {
    return "grid-cols-1";
  }

  return "grid-cols-[minmax(0,1fr)_auto]";
}

function resolveAddAction(
  usingProvider: boolean,
  addWithValidationFn: (fileList: File[] | FileList) => void,
  addLocal: (fileList: File[] | FileList) => void
): (fileList: File[] | FileList) => void {
  if (usingProvider) {
    return addWithValidationFn;
  }

  return addLocal;
}

function resolveRemoveAction(
  usingProvider: boolean,
  providerRemove: ((id: string) => void) | undefined,
  removeLocal: (id: string) => void
): (id: string) => void {
  if (usingProvider && providerRemove) {
    return providerRemove;
  }

  return removeLocal;
}

function resolveOpenAction(
  usingProvider: boolean,
  providerOpen: (() => void) | undefined,
  openLocal: () => void
): () => void {
  if (usingProvider && providerOpen) {
    return providerOpen;
  }

  return openLocal;
}

function usePromptInputLayout(args: {
  compact: boolean;
  filesLength: number;
  referencedSourcesLength: number;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [textareaExpanded, setTextareaExpanded] = useState(false);
  const animateLayout = args.compact && !shouldReduceMotion;

  const expanded = isExpanded({
    compact: args.compact,
    textareaExpanded,
    filesLength: args.filesLength,
    referencedSourcesLength: args.referencedSourcesLength,
  });

  const layout = useMemo(
    () =>
      buildLayoutValue({
        animateLayout,
        compact: args.compact,
        expanded,
        setTextareaExpanded,
      }),
    [animateLayout, args.compact, expanded]
  );

  return { layout, animateLayout, expanded };
}

function useLocalAttachmentItems(args: {
  accept: string | undefined;
  maxFiles: number | undefined;
  maxFileSize: number | undefined;
  onError?: PromptInputErrorHandler;
}) {
  const [items, setItems] = useState<AttachmentFile[]>([]);

  const matchesAccept = useCallback(
    (file: File) => fileMatchesAccept(file, args.accept),
    [args.accept]
  );

  const addLocal = useCallback(
    (fileList: File[] | FileList) => {
      addLocalFiles({
        fileList,
        matchesAccept,
        maxFiles: args.maxFiles,
        maxFileSize: args.maxFileSize,
        onError: args.onError,
        setItems,
      });
    },
    [matchesAccept, args.maxFiles, args.maxFileSize, args.onError]
  );

  const removeLocal = useCallback((id: string) => {
    setItems((previous) => removeLocalAttachment(previous, id));
  }, []);

  return { items, setItems, matchesAccept, addLocal, removeLocal };
}

function useAttachmentActions(args: {
  usingProvider: boolean;
  filesLength: number;
  matchesAccept: (file: File) => boolean;
  maxFiles: number | undefined;
  maxFileSize: number | undefined;
  onError?: PromptInputErrorHandler;
  providerAdd?: (files: File[] | FileList) => void;
  providerClear?: () => void;
  providerRemove?: (id: string) => void;
  providerOpen?: () => void;
  addLocal: (fileList: File[] | FileList) => void;
  removeLocal: (id: string) => void;
  setItems: Dispatch<SetStateAction<AttachmentFile[]>>;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const addWithValidation = useCallback(
    (fileList: File[] | FileList) => {
      addWithProviderValidation({
        fileList,
        matchesAccept: args.matchesAccept,
        maxFileSize: args.maxFileSize,
        maxFiles: args.maxFiles,
        onError: args.onError,
        currentCount: args.filesLength,
        providerAdd: args.providerAdd,
      });
    },
    [
      args.matchesAccept,
      args.maxFileSize,
      args.maxFiles,
      args.onError,
      args.filesLength,
      args.providerAdd,
    ]
  );

  const clearAttachments = useCallback(() => {
    clearAttachmentsState({
      usingProvider: args.usingProvider,
      providerClear: args.providerClear,
      setItems: args.setItems,
    });
  }, [args.usingProvider, args.providerClear, args.setItems]);

  const openFileDialogLocal = useCallback(() => {
    args.inputRef.current?.click();
  }, [args.inputRef]);

  const add = resolveAddAction(
    args.usingProvider,
    addWithValidation,
    args.addLocal
  );

  const remove = resolveRemoveAction(
    args.usingProvider,
    args.providerRemove,
    args.removeLocal
  );

  const openFileDialog = resolveOpenAction(
    args.usingProvider,
    args.providerOpen,
    openFileDialogLocal
  );

  return { add, remove, openFileDialog, clearAttachments };
}

function useReferencedSourcesState() {
  const [referencedSources, setReferencedSources] = useState<
    (SourceDocumentUIPart & { id: string })[]
  >([]);

  const clearReferencedSources = useCallback(() => {
    setReferencedSources([]);
  }, []);

  const refsCtx = useMemo(
    () =>
      buildRefsCtx({
        referencedSources,
        clearReferencedSources,
        setReferencedSources,
      }),
    [referencedSources, clearReferencedSources]
  );

  return { referencedSources, clearReferencedSources, refsCtx };
}

function usePromptInputFileEffects(params: {
  usingProvider: boolean;
  registerFileInput?: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void
  ) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  filesRef: RefObject<AttachmentFile[]>;
  files: AttachmentFile[];
  syncHiddenInput: boolean | undefined;
}) {
  const {
    usingProvider,
    registerFileInput,
    inputRef,
    filesRef,
    files,
    syncHiddenInput,
  } = params;

  useEffect(() => {
    filesRef.current = files;
  }, [files, filesRef]);

  useEffect(() => {
    if (!usingProvider) {
      return;
    }

    registerFileInput?.(inputRef, () => {
      inputRef.current?.click();
    });
  }, [usingProvider, registerFileInput, inputRef]);

  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files.length, syncHiddenInput, inputRef]);

  useEffect(
    () => () => {
      if (!usingProvider) {
        revokeAttachmentUrls(filesRef.current);
      }
    },
    [usingProvider, filesRef]
  );
}

function usePromptInputDropEffects(params: {
  formRef: RefObject<HTMLFormElement | null>;
  globalDrop: boolean | undefined;
  add: (files: File[] | FileList) => void;
}) {
  const { formRef, globalDrop, add } = params;

  useEffect(() => {
    const form = formRef.current;

    if (!form || globalDrop) {
      return undefined;
    }

    const onDragOver = (event: DragEvent) => {
      preventFileDragDefault(event);
    };

    const onDrop = (event: DragEvent) => {
      const dropped = filesFromDragEvent(event);

      if (dropped) {
        add(dropped);
      }
    };

    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);

    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop, formRef]);

  useEffect(() => {
    if (!globalDrop) {
      return undefined;
    }

    const onDragOver = (event: DragEvent) => {
      preventFileDragDefault(event);
    };

    const onDrop = (event: DragEvent) => {
      const dropped = filesFromDragEvent(event);

      if (dropped) {
        add(dropped);
      }
    };

    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);

    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);
}

function usePromptInputSubmit(params: {
  usingProvider: boolean;
  providerText?: string;
  providerClearText?: () => void;
  files: AttachmentFile[];
  onSubmit: PromptInputProps["onSubmit"];
  clearAttachments: () => void;
  clearReferencedSources: () => void;
}) {
  const {
    usingProvider,
    providerText,
    providerClearText,
    files,
    onSubmit,
    clearAttachments,
    clearReferencedSources,
  } = params;

  const clear = useCallback(() => {
    clearAttachments();
    clearReferencedSources();
  }, [clearAttachments, clearReferencedSources]);

  const handleSubmit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      await runPromptSubmit({
        event,
        usingProvider,
        providerText,
        providerClearText,
        files,
        onSubmit,
        clear,
      });
    },
    [usingProvider, providerText, providerClearText, files, onSubmit, clear]
  );

  const onFormSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      void handleSubmit(event);
    },
    [handleSubmit]
  );

  return { clear, handleSubmit, onFormSubmit };
}

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  compact = false,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const controller = useOptionalPromptInputController();
  const usingProvider = controller != null;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const { items, setItems, matchesAccept, addLocal, removeLocal } =
    useLocalAttachmentItems({ accept, maxFiles, maxFileSize, onError });

  const files = resolveFiles(
    usingProvider,
    controller?.attachments.files,
    items
  );

  const { referencedSources, clearReferencedSources, refsCtx } =
    useReferencedSourcesState();

  const { layout, animateLayout, expanded } = usePromptInputLayout({
    compact,
    filesLength: files.length,
    referencedSourcesLength: referencedSources.length,
  });

  const { add, remove, openFileDialog, clearAttachments } =
    useAttachmentActions({
      usingProvider,
      filesLength: files.length,
      matchesAccept,
      maxFiles,
      maxFileSize,
      onError,
      providerAdd: controller?.attachments.add,
      providerClear: controller?.attachments.clear,
      providerRemove: controller?.attachments.remove,
      providerOpen: controller?.attachments.openFileDialog,
      addLocal,
      removeLocal,
      setItems,
      inputRef,
    });

  const filesRef = useRef(files);

  usePromptInputFileEffects({
    usingProvider,
    registerFileInput: controller?.registerFileInput,
    inputRef,
    filesRef,
    files,
    syncHiddenInput,
  });

  usePromptInputDropEffects({ formRef, globalDrop, add });

  const { onFormSubmit } = usePromptInputSubmit({
    usingProvider,
    providerText: controller?.textInput.value,
    providerClearText: controller?.textInput.clear,
    files,
    onSubmit,
    clearAttachments,
    clearReferencedSources,
  });

  const handleChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }

      event.currentTarget.value = "";
    },
    [add]
  );

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear: clearAttachments,
      fileInputRef: inputRef,
      files,
      openFileDialog,
      remove,
    }),
    [files, add, remove, clearAttachments, openFileDialog]
  );

  const gridColsClass = compactInputGroupClassName(compact, expanded);

  const inner = (
    <>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form
        className={cn("w-full", className)}
        onSubmit={onFormSubmit}
        ref={formRef}
        {...props}
      >
        <LazyMotion features={domMax}>
          <PromptInputLayoutContext.Provider value={layout}>
            <MotionInputGroup
              className={cn(
                "overflow-hidden",
                compact && "grid! items-center",
                gridColsClass
              )}
              data-compact={compact || undefined}
              data-expanded={expanded || undefined}
              layout={animateLayout}
              transition={{ layout: promptInputLayoutTransition }}
            >
              {children}
            </MotionInputGroup>
          </PromptInputLayoutContext.Provider>
        </LazyMotion>
      </form>
    </>
  );

  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx}>
      <LocalReferencedSourcesContext.Provider value={refsCtx}>
        {inner}
      </LocalReferencedSourcesContext.Provider>
    </LocalAttachmentsContext.Provider>
  );
};
