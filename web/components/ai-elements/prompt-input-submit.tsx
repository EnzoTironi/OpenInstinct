"use client";

import { PromptInputLayoutContext } from "@web/components/ai-elements/prompt-input-context";
import { promptInputLayoutTransition } from "@web/components/ai-elements/prompt-input-helpers";
import { cn } from "@web/components/class-names";
import { InputGroupButton } from "@web/components/ui/input-group";
import { Spinner } from "@web/components/ui/spinner";
import type { ChatStatus } from "ai";
import { CornerDownLeftIcon, SquareIcon, XIcon } from "lucide-react";
import { m } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useContext } from "react";

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

function isGeneratingStatus(status: ChatStatus | undefined): boolean {
  return status === "submitted" || status === "streaming";
}

function resolveSubmitIcon(status: ChatStatus | undefined): ReactNode {
  if (status === "submitted") {
    return <Spinner />;
  }

  if (status === "streaming") {
    return <SquareIcon className="size-4" />;
  }

  if (status === "error") {
    return <XIcon className="size-4" />;
  }

  return <CornerDownLeftIcon className="size-4" />;
}

function resolveSubmitAriaLabel(isGenerating: boolean): string {
  if (isGenerating) {
    return "Stop";
  }

  return "Submit";
}

function resolveSubmitButtonType(
  isGenerating: boolean,
  onStop: (() => void) | undefined
): "button" | "submit" {
  if (isGenerating && onStop) {
    return "button";
  }

  return "submit";
}

function resolveLayoutPosition(animateLayout: boolean): "position" | false {
  if (animateLayout) {
    return "position";
  }

  return false;
}

function handleSubmitClick(args: {
  event: Parameters<NonNullable<PromptInputSubmitProps["onClick"]>>[0];
  isGenerating: boolean;
  onStop?: () => void;
  onClick?: PromptInputSubmitProps["onClick"];
}): void {
  if (args.isGenerating && args.onStop) {
    args.event.preventDefault();
    args.onStop();

    return;
  }

  args.onClick?.(args.event);
}

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const layout = useContext(PromptInputLayoutContext);
  const isGenerating = isGeneratingStatus(status);
  const Icon = resolveSubmitIcon(status);

  const handleClick = useCallback<
    NonNullable<PromptInputSubmitProps["onClick"]>
  >(
    (event) => {
      handleSubmitClick({
        event,
        isGenerating,
        onStop,
        onClick,
      });
    },
    [isGenerating, onStop, onClick]
  );

  const button = (
    <InputGroupButton
      aria-label={resolveSubmitAriaLabel(isGenerating)}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={resolveSubmitButtonType(isGenerating, onStop)}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  );

  if (!layout?.compact) {
    return button;
  }

  return (
    <span className="size-8 shrink-0">
      <m.span
        className="absolute right-1.5 bottom-1.5 inline-flex"
        layout={resolveLayoutPosition(layout.animateLayout)}
        transition={{ layout: promptInputLayoutTransition }}
      >
        {button}
      </m.span>
    </span>
  );
};
