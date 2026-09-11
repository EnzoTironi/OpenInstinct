"use client";

import {
  PromptInputLayoutContext,
  useOptionalPromptInputController,
  usePromptInputAttachments,
  type AttachmentsContext,
} from "@web/components/ai-elements/prompt-input-context";
import {
  computeTextareaAvailableWidth,
  copyTextareaFontToMeasurement,
  promptInputLayoutTransition,
} from "@web/components/ai-elements/prompt-input-helpers";
import { cn } from "@web/components/class-names";
import { InputGroupTextarea } from "@web/components/ui/input-group";
import { m } from "motion/react";
import type {
  ChangeEvent,
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  KeyboardEventHandler,
  RefObject,
} from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

function initialMeasurementValue(
  controllerValue: string | undefined,
  value: PromptInputTextareaProps["value"],
  defaultValue: PromptInputTextareaProps["defaultValue"]
): string {
  return String(controllerValue ?? value ?? defaultValue ?? "");
}

function resolveMeasurementValue(
  controlledValue: string | number | readonly string[] | undefined,
  uncontrolledMeasurementValue: string
): string {
  if (controlledValue === undefined) {
    return uncontrolledMeasurementValue;
  }

  return String(controlledValue);
}

function applyCompactMeasurement(args: {
  measurementValue: string;
  textarea: HTMLTextAreaElement;
  measurement: HTMLElement;
  inputGroup: HTMLElement;
  footer: HTMLElement;
  setTextareaExpanded: (expanded: boolean) => void;
}): void {
  if (args.measurementValue.includes("\n")) {
    args.setTextareaExpanded(true);

    return;
  }

  copyTextareaFontToMeasurement(args.textarea, args.measurement);

  const availableWidth = computeTextareaAvailableWidth(
    args.inputGroup,
    args.footer,
    args.textarea
  );

  args.setTextareaExpanded(
    args.measurement.getBoundingClientRect().width > availableWidth
  );
}

function resolveCompactMeasurementTargets(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  measurementRef: RefObject<HTMLSpanElement | null>
): {
  textarea: HTMLTextAreaElement;
  measurement: HTMLElement;
  inputGroup: HTMLElement;
  footer: HTMLElement;
} | null {
  const textarea = textareaRef.current;
  const measurement = measurementRef.current;

  if (!(textarea && measurement)) {
    return null;
  }

  const inputGroup = textarea.closest<HTMLElement>('[data-slot="input-group"]');

  const footer = inputGroup?.querySelector<HTMLElement>(
    "[data-prompt-input-footer]"
  );

  if (!(inputGroup && footer)) {
    return null;
  }

  return { textarea, measurement, inputGroup, footer };
}

function observeCompactMeasurement(
  inputGroup: HTMLElement,
  footer: HTMLElement,
  measure: () => void
): (() => void) | undefined {
  if (typeof ResizeObserver === "undefined") {
    return undefined;
  }

  const observer = new ResizeObserver(measure);
  observer.observe(inputGroup);
  observer.observe(footer);

  return () => {
    observer.disconnect();
  };
}

function shouldIgnoreEnterSubmit(
  event: Parameters<KeyboardEventHandler<HTMLTextAreaElement>>[0],
  isComposing: boolean
): boolean {
  if (isComposing || event.nativeEvent.isComposing) {
    return true;
  }

  return event.shiftKey;
}

function handleEnterKeySubmit(
  event: Parameters<KeyboardEventHandler<HTMLTextAreaElement>>[0]
): void {
  event.preventDefault();

  const { form } = event.currentTarget;

  const submitButton = form?.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );

  if (submitButton?.disabled) {
    return;
  }

  form?.requestSubmit();
}

function handleBackspaceRemoveAttachment(
  event: Parameters<KeyboardEventHandler<HTMLTextAreaElement>>[0],
  attachments: AttachmentsContext
): void {
  const isEmptyBackspace =
    event.key === "Backspace" &&
    event.currentTarget.value === "" &&
    attachments.files.length > 0;

  if (!isEmptyBackspace) {
    return;
  }

  event.preventDefault();
  const lastAttachment = attachments.files.at(-1);

  if (lastAttachment) {
    attachments.remove(lastAttachment.id);
  }
}

function handleTextareaKeyDown(
  event: Parameters<KeyboardEventHandler<HTMLTextAreaElement>>[0],
  onKeyDown: PromptInputTextareaProps["onKeyDown"],
  isComposing: boolean,
  attachments: AttachmentsContext
): void {
  onKeyDown?.(event);

  if (event.defaultPrevented) {
    return;
  }

  if (event.key === "Enter") {
    if (shouldIgnoreEnterSubmit(event, isComposing)) {
      return;
    }

    handleEnterKeySubmit(event);

    return;
  }

  handleBackspaceRemoveAttachment(event, attachments);
}

function collectClipboardFile(item: DataTransferItem, files: File[]): void {
  if (item.kind !== "file") {
    return;
  }

  const file = item.getAsFile();

  if (file) {
    files.push(file);
  }
}

function collectClipboardFiles(items: DataTransferItemList): File[] {
  const files: File[] = [];

  for (const item of items) {
    collectClipboardFile(item, files);
  }

  return files;
}

function handleTextareaPaste(
  event: Parameters<ClipboardEventHandler<HTMLTextAreaElement>>[0],
  attachments: AttachmentsContext
): void {
  const files = collectClipboardFiles(event.clipboardData.items);

  if (files.length === 0) {
    return;
  }

  event.preventDefault();
  attachments.add(files);
}

function resolveLayoutPosition(animateLayout: boolean): "position" | false {
  if (animateLayout) {
    return "position";
  }

  return false;
}

function useTextareaImperativeRef(
  ref: PromptInputTextareaProps["ref"],
  textareaRef: RefObject<HTMLTextAreaElement | null>
) {
  useImperativeHandle(ref, () => {
    const textarea = textareaRef.current;

    if (!textarea) {
      throw new Error("Prompt input textarea ref initialized before mount");
    }

    return textarea;
  });
}

function useFormResetMeasurement(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setUncontrolledMeasurementValue: (value: string) => void
) {
  useEffect(() => {
    const textarea = textareaRef.current;
    const form = textarea?.form;

    if (!(textarea && form)) {
      return undefined;
    }

    const handleReset = () => {
      queueMicrotask(() => {
        setUncontrolledMeasurementValue(textarea.value);
      });
    };

    form.addEventListener("reset", handleReset);

    return () => {
      form.removeEventListener("reset", handleReset);
    };
  }, [textareaRef, setUncontrolledMeasurementValue]);
}

function useCompactTextareaMeasurement(args: {
  layout: {
    compact: boolean;
    setTextareaExpanded: (expanded: boolean) => void;
  } | null;
  measurementValue: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  measurementRef: RefObject<HTMLSpanElement | null>;
}) {
  const { layout, measurementValue, textareaRef, measurementRef } = args;

  useLayoutEffect(() => {
    if (!layout?.compact) {
      return undefined;
    }

    const targets = resolveCompactMeasurementTargets(
      textareaRef,
      measurementRef
    );

    if (!targets) {
      return undefined;
    }

    const measure = () => {
      applyCompactMeasurement({
        measurementValue,
        textarea: targets.textarea,
        measurement: targets.measurement,
        inputGroup: targets.inputGroup,
        footer: targets.footer,
        setTextareaExpanded: layout.setTextareaExpanded,
      });
    };

    measure();

    return observeCompactMeasurement(
      targets.inputGroup,
      targets.footer,
      measure
    );
  }, [layout, measurementValue, textareaRef, measurementRef]);
}

function useTextareaEventHandlers(args: {
  onKeyDown: PromptInputTextareaProps["onKeyDown"];
  isComposing: boolean;
  attachments: AttachmentsContext;
  setIsComposing: (value: boolean) => void;
}) {
  const { onKeyDown, isComposing, attachments, setIsComposing } = args;

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      handleTextareaKeyDown(event, onKeyDown, isComposing, attachments);
    },
    [onKeyDown, isComposing, attachments]
  );

  const handlePaste = useCallback<ClipboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      handleTextareaPaste(event, attachments);
    },
    [attachments]
  );

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, [setIsComposing]);

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, [setIsComposing]);

  return {
    handleKeyDown,
    handlePaste,
    handleCompositionEnd,
    handleCompositionStart,
  };
}

function buildControlledChange(
  setInput: (value: string) => void,
  onChange: PromptInputTextareaProps["onChange"]
): ChangeEventHandler<HTMLTextAreaElement> {
  return (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.currentTarget.value);
    onChange?.(event);
  };
}

function buildUncontrolledChange(
  setUncontrolledMeasurementValue: (value: string) => void,
  onChange: PromptInputTextareaProps["onChange"]
): ChangeEventHandler<HTMLTextAreaElement> {
  return (event: ChangeEvent<HTMLTextAreaElement>) => {
    setUncontrolledMeasurementValue(event.currentTarget.value);
    onChange?.(event);
  };
}

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ref,
  value,
  defaultValue,
  ...props
}: PromptInputTextareaProps) => {
  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();
  const layout = useContext(PromptInputLayoutContext);
  const [isComposing, setIsComposing] = useState(false);

  const [uncontrolledMeasurementValue, setUncontrolledMeasurementValue] =
    useState(() =>
      initialMeasurementValue(controller?.textInput.value, value, defaultValue)
    );

  const controlledValue = controller?.textInput.value ?? value;

  const measurementValue = resolveMeasurementValue(
    controlledValue,
    uncontrolledMeasurementValue
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measurementRef = useRef<HTMLSpanElement>(null);

  useTextareaImperativeRef(ref, textareaRef);
  useFormResetMeasurement(textareaRef, setUncontrolledMeasurementValue);
  useCompactTextareaMeasurement({
    layout,
    measurementValue,
    textareaRef,
    measurementRef,
  });

  const {
    handleKeyDown,
    handlePaste,
    handleCompositionEnd,
    handleCompositionStart,
  } = useTextareaEventHandlers({
    onKeyDown,
    isComposing,
    attachments,
    setIsComposing,
  });

  const controlledProps = controller
    ? {
        onChange: buildControlledChange(
          controller.textInput.setInput,
          onChange
        ),
        value: controller.textInput.value,
      }
    : {
        onChange: buildUncontrolledChange(
          setUncontrolledMeasurementValue,
          onChange
        ),
        defaultValue,
        value,
      };

  const textarea = (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      name="message"
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      ref={textareaRef}
      {...props}
      {...controlledProps}
    />
  );

  if (!layout?.compact) {
    return textarea;
  }

  return (
    <>
      <m.div
        className="min-w-0"
        layout={resolveLayoutPosition(layout.animateLayout)}
        transition={{ layout: promptInputLayoutTransition }}
      >
        {textarea}
      </m.div>
      <span
        aria-hidden="true"
        className="pointer-events-none invisible fixed top-0 left-0 w-max whitespace-pre"
        ref={measurementRef}
      >
        {measurementValue}
      </span>
    </>
  );
};
