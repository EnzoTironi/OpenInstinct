"use client";

import { cn } from "@web/components/class-names";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@web/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@web/components/ui/hover-card";
import {
  InputGroupAddon,
  InputGroupButton,
} from "@web/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip";
import { ImageIcon, Monitor, PlusIcon } from "lucide-react";
import type {
  ComponentProps,
  HTMLAttributes,
  ReactNode,
  SyntheticEvent,
} from "react";
import { Children, useCallback, useContext } from "react";
import { z } from "zod";

import {
  LocalReferencedSourcesContext,
  PromptInputLayoutContext,
  usePromptInputAttachments,
  usePromptInputController,
  usePromptInputReferencedSources,
  useProviderAttachments,
  type AttachmentsContext,
  type PromptInputControllerProps,
  type PromptInputProviderProps,
  type ReferencedSourcesContext,
  type TextInputContext,
} from "./prompt-input-context";
import {
  PromptInput,
  type PromptInputMessage,
  type PromptInputProps,
} from "./prompt-input-form";
import { PromptInputProvider } from "./prompt-input-provider";
import { captureScreenshot } from "./prompt-input-screenshot";
import {
  PromptInputSubmit,
  type PromptInputSubmitProps,
} from "./prompt-input-submit";
import {
  PromptInputTextarea,
  type PromptInputTextareaProps,
} from "./prompt-input-textarea";

export type {
  AttachmentsContext,
  PromptInputControllerProps,
  PromptInputMessage,
  PromptInputProps,
  PromptInputProviderProps,
  PromptInputSubmitProps,
  PromptInputTextareaProps,
  ReferencedSourcesContext,
  TextInputContext,
};

export {
  LocalReferencedSourcesContext,
  PromptInput,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  usePromptInputController,
  usePromptInputReferencedSources,
  useProviderAttachments,
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputActionAddAttachmentsProps = ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

type DropdownMenuSelectEvent = SyntheticEvent<HTMLDivElement> & {
  preventBaseUIHandler: () => void;
  readonly baseUIHandlerPrevented?: boolean;
};

export const PromptInputActionAddAttachments = ({
  label = "Add photos or files",
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  const handleSelect = useCallback(
    (e: DropdownMenuSelectEvent) => {
      e.preventDefault();
      attachments.openFileDialog();
    },
    [attachments]
  );

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  );
};

export type PromptInputActionAddScreenshotProps = ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddScreenshot = ({
  label = "Take screenshot",
  onSelect,
  ...props
}: PromptInputActionAddScreenshotProps) => {
  const attachments = usePromptInputAttachments();

  const handleSelect = useCallback(
    (event: DropdownMenuSelectEvent) => {
      onSelect?.(event);

      if (event.defaultPrevented) {
        return;
      }

      void (async () => {
        try {
          const screenshot = await captureScreenshot();

          if (screenshot) {
            attachments.add([screenshot]);
          }
        } catch (error) {
          if (
            error instanceof DOMException &&
            (error.name === "NotAllowedError" || error.name === "AbortError")
          ) {
            return;
          }

          throw error;
        }
      })();
    },
    [onSelect, attachments]
  );

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <Monitor className="mr-2 size-4" />
      {label}
    </DropdownMenuItem>
  );
};

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => {
  const layout = useContext(PromptInputLayoutContext);

  return (
    <InputGroupAddon
      align="block-end"
      className={cn(
        "order-first flex-wrap gap-1",
        layout?.compact && !layout.expanded && "hidden",
        className
      )}
      {...props}
    />
  );
};

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => {
  const layout = useContext(PromptInputLayoutContext);

  return (
    <InputGroupAddon
      align="block-end"
      className={cn(
        "justify-between gap-1",
        layout?.compact && "px-1.5!",
        layout?.compact &&
          !layout.expanded &&
          "col-start-2 row-start-1 w-auto! justify-end pb-1.5!",
        className
      )}
      data-prompt-input-footer=""
      {...props}
    />
  );
};

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn("flex min-w-0 items-center gap-1", className)}
    {...props}
  />
);

export type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode;
      shortcut?: string;
      side?: ComponentProps<typeof TooltipContent>["side"];
    };

const promptInputButtonTooltipOptionsSchema = z.object({
  content: z.custom<ReactNode>(),
  shortcut: z.string().optional(),
  side: z.enum(["bottom", "left", "right", "top"]).optional(),
});

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  tooltip,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");

  const button = (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  const tooltipText = z.string().safeParse(tooltip);

  const tooltipOptions = tooltipText.success
    ? undefined
    : promptInputButtonTooltipOptionsSchema.parse(tooltip);

  const tooltipContent = tooltipText.success
    ? tooltipText.data
    : tooltipOptions?.content;

  const shortcut = tooltipOptions?.shortcut;
  const side = tooltipOptions?.side ?? "top";

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && (
          <span className="ml-2 text-muted-foreground">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;

export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger
    render={
      <PromptInputButton className={className} {...props}>
        {children ?? <PlusIcon className="size-4" />}
      </PromptInputButton>
    }
  />
);

export type PromptInputActionMenuContentProps = ComponentProps<
  typeof DropdownMenuContent
>;

export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" className={cn(className)} {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<
  typeof DropdownMenuItem
>;

export const PromptInputActionMenuItem = ({
  className,
  ...props
}: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem className={cn(className)} {...props} />
);

// Note: Actions that perform side-effects (like opening a file dialog)
// are provided in opt-in modules (e.g., prompt-input-attachments).
export type PromptInputSelectProps = ComponentProps<typeof Select>;

export const PromptInputSelect = (props: PromptInputSelectProps) => (
  <Select {...props} />
);

export type PromptInputSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const PromptInputSelectTrigger = ({
  className,
  ...props
}: PromptInputSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      "border-none bg-transparent text-muted-foreground shadow-none transition-colors",
      "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
      className
    )}
    {...props}
  />
);

export type PromptInputSelectContentProps = ComponentProps<
  typeof SelectContent
>;

export const PromptInputSelectContent = ({
  className,
  ...props
}: PromptInputSelectContentProps) => (
  <SelectContent className={cn(className)} {...props} />
);

export type PromptInputSelectItemProps = ComponentProps<typeof SelectItem>;

export const PromptInputSelectItem = ({
  className,
  ...props
}: PromptInputSelectItemProps) => (
  <SelectItem className={cn(className)} {...props} />
);

export type PromptInputSelectValueProps = ComponentProps<typeof SelectValue>;

export const PromptInputSelectValue = ({
  className,
  ...props
}: PromptInputSelectValueProps) => (
  <SelectValue className={cn(className)} {...props} />
);

export type PromptInputHoverCardProps = ComponentProps<typeof HoverCard> & {
  openDelay?: number;
  closeDelay?: number;
};

export const PromptInputHoverCard = ({
  openDelay: _openDelay = 0,
  closeDelay: _closeDelay = 0,
  ...props
}: PromptInputHoverCardProps) => {
  void _openDelay;
  void _closeDelay;

  return <HoverCard {...props} />;
};

export type PromptInputHoverCardTriggerProps = ComponentProps<
  typeof HoverCardTrigger
>;

export const PromptInputHoverCardTrigger = (
  props: PromptInputHoverCardTriggerProps
) => <HoverCardTrigger {...props} />;

export type PromptInputHoverCardContentProps = ComponentProps<
  typeof HoverCardContent
>;

export const PromptInputHoverCardContent = ({
  align = "start",
  ...props
}: PromptInputHoverCardContentProps) => (
  <HoverCardContent align={align} {...props} />
);

export type PromptInputTabsListProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabsList = ({
  className,
  ...props
}: PromptInputTabsListProps) => <div className={cn(className)} {...props} />;

export type PromptInputTabProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTab = ({
  className,
  ...props
}: PromptInputTabProps) => <div className={cn(className)} {...props} />;

export type PromptInputTabLabelProps = HTMLAttributes<HTMLHeadingElement>;

export const PromptInputTabLabel = ({
  children,
  className,
  ...props
}: PromptInputTabLabelProps) => (
  <h3
    className={cn("mb-2 px-3 type-card-title text-muted-foreground", className)}
    {...props}
  >
    {children}
  </h3>
);

export type PromptInputTabBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabBody = ({
  className,
  ...props
}: PromptInputTabBodyProps) => (
  <div className={cn("space-y-1", className)} {...props} />
);

export type PromptInputTabItemProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabItem = ({
  className,
  ...props
}: PromptInputTabItemProps) => (
  <div
    className={cn(
      "flex items-center gap-2 px-3 py-2 type-caption hover:bg-accent",
      className
    )}
    {...props}
  />
);

export type PromptInputCommandProps = ComponentProps<typeof Command>;

export const PromptInputCommand = ({
  className,
  ...props
}: PromptInputCommandProps) => <Command className={cn(className)} {...props} />;

export type PromptInputCommandInputProps = ComponentProps<typeof CommandInput>;

export const PromptInputCommandInput = ({
  className,
  ...props
}: PromptInputCommandInputProps) => (
  <CommandInput className={cn(className)} {...props} />
);

export type PromptInputCommandListProps = ComponentProps<typeof CommandList>;

export const PromptInputCommandList = ({
  className,
  ...props
}: PromptInputCommandListProps) => (
  <CommandList className={cn(className)} {...props} />
);

export type PromptInputCommandEmptyProps = ComponentProps<typeof CommandEmpty>;

export const PromptInputCommandEmpty = ({
  className,
  ...props
}: PromptInputCommandEmptyProps) => (
  <CommandEmpty className={cn(className)} {...props} />
);

export type PromptInputCommandGroupProps = ComponentProps<typeof CommandGroup>;

export const PromptInputCommandGroup = ({
  className,
  ...props
}: PromptInputCommandGroupProps) => (
  <CommandGroup className={cn(className)} {...props} />
);

export type PromptInputCommandItemProps = ComponentProps<typeof CommandItem>;

export const PromptInputCommandItem = ({
  className,
  ...props
}: PromptInputCommandItemProps) => (
  <CommandItem className={cn(className)} {...props} />
);

export type PromptInputCommandSeparatorProps = ComponentProps<
  typeof CommandSeparator
>;

export const PromptInputCommandSeparator = ({
  className,
  ...props
}: PromptInputCommandSeparatorProps) => (
  <CommandSeparator className={cn(className)} {...props} />
);
