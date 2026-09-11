"use client";

import {
  PromptInputController,
  ProviderAttachmentsContext,
  type AttachmentsContext,
  type PromptInputControllerProps,
  type PromptInputProviderProps,
} from "@web/components/ai-elements/prompt-input-context";
import {
  fileToAttachment,
  revokeAttachmentUrl,
  revokeAttachmentUrls,
  type AttachmentFile,
} from "@web/components/ai-elements/prompt-input-helpers";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function appendIncomingAttachments(
  previous: AttachmentFile[],
  incoming: File[]
): AttachmentFile[] {
  return [...previous, ...incoming.map(fileToAttachment)];
}

function addAttachmentFiles(
  setAttachmentFiles: Dispatch<SetStateAction<AttachmentFile[]>>,
  files: File[] | FileList
): void {
  const incoming = [...files];

  if (incoming.length === 0) {
    return;
  }

  setAttachmentFiles((previous) =>
    appendIncomingAttachments(previous, incoming)
  );
}

function removeAttachmentById(
  previous: AttachmentFile[],
  id: string
): AttachmentFile[] {
  const found = previous.find((file) => file.id === id);
  revokeAttachmentUrl(found ?? {});

  return previous.filter((file) => file.id !== id);
}

function removeAttachmentFile(
  setAttachmentFiles: Dispatch<SetStateAction<AttachmentFile[]>>,
  id: string
): void {
  setAttachmentFiles((previous) => removeAttachmentById(previous, id));
}

function clearAttachmentFilesState(
  setAttachmentFiles: Dispatch<SetStateAction<AttachmentFile[]>>
): void {
  setAttachmentFiles((previous) => {
    revokeAttachmentUrls(previous);

    return [];
  });
}

function buildAttachmentsContext(args: {
  add: AttachmentsContext["add"];
  clear: AttachmentsContext["clear"];
  fileInputRef: RefObject<HTMLInputElement | null>;
  files: AttachmentFile[];
  openFileDialog: () => void;
  remove: AttachmentsContext["remove"];
}): AttachmentsContext {
  return {
    add: args.add,
    clear: args.clear,
    fileInputRef: args.fileInputRef,
    files: args.files,
    openFileDialog: args.openFileDialog,
    remove: args.remove,
  };
}

function buildController(args: {
  registerFileInput: PromptInputControllerProps["registerFileInput"];
  attachments: AttachmentsContext;
  clearInput: () => void;
  setTextInput: Dispatch<SetStateAction<string>>;
  textInput: string;
}): PromptInputControllerProps {
  return {
    registerFileInput: args.registerFileInput,
    attachments: args.attachments,
    textInput: {
      clear: args.clearInput,
      setInput: args.setTextInput,
      value: args.textInput,
    },
  };
}

function useProviderTextInput(initialTextInput: string) {
  const [textInput, setTextInput] = useState(initialTextInput);

  const clearInput = useCallback(() => {
    setTextInput("");
  }, []);

  return { textInput, setTextInput, clearInput };
}

function useProviderAttachmentFiles() {
  const [attachmentFiles, setAttachmentFiles] = useState<AttachmentFile[]>([]);
  const attachmentsRef = useRef(attachmentFiles);

  const add = useCallback((files: File[] | FileList) => {
    addAttachmentFiles(setAttachmentFiles, files);
  }, []);

  const remove = useCallback((id: string) => {
    removeAttachmentFile(setAttachmentFiles, id);
  }, []);

  const clear = useCallback(() => {
    clearAttachmentFilesState(setAttachmentFiles);
  }, []);

  useEffect(() => {
    attachmentsRef.current = attachmentFiles;
  }, [attachmentFiles]);

  useEffect(
    () => () => {
      revokeAttachmentUrls(attachmentsRef.current);
    },
    []
  );

  return { attachmentFiles, add, remove, clear };
}

function useProviderFileDialog() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef<(() => void) | undefined>(undefined);

  const openFileDialog = useCallback(() => {
    openRef.current?.();
  }, []);

  const registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current;
      openRef.current = open;
    },
    []
  );

  return { fileInputRef, openFileDialog, registerFileInput };
}

/**
 * Optional global provider that lifts PromptInput state outside of PromptInput.
 * If you don't use it, PromptInput stays fully self-managed.
 */
export const PromptInputProvider = ({
  initialInput: initialTextInput = "",
  children,
}: PromptInputProviderProps) => {
  const { textInput, setTextInput, clearInput } =
    useProviderTextInput(initialTextInput);

  const { attachmentFiles, add, remove, clear } = useProviderAttachmentFiles();

  const { fileInputRef, openFileDialog, registerFileInput } =
    useProviderFileDialog();

  const attachments = useMemo(
    () =>
      buildAttachmentsContext({
        add,
        clear,
        fileInputRef,
        files: attachmentFiles,
        openFileDialog,
        remove,
      }),
    [attachmentFiles, add, remove, clear, openFileDialog, fileInputRef]
  );

  const controller = useMemo(
    () =>
      buildController({
        registerFileInput,
        attachments,
        clearInput,
        setTextInput,
        textInput,
      }),
    [textInput, clearInput, attachments, registerFileInput, setTextInput]
  );

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  );
};
