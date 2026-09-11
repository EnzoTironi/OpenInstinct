"use client";

import { cn } from "@web/components/class-names";
import { Button } from "@web/components/ui/button";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { z } from "zod";

export type ConversationProps = ComponentProps<typeof StickToBottom> & {
  scrollRestorationKey?: string;
};

type ConversationRenderChild = Extract<
  NonNullable<ConversationProps["children"]>,
  (...args: never[]) => React.ReactNode
>;

const scrollPositionSchema = z.object({
  atBottom: z.boolean(),
  scrollTop: z.number(),
});

const isConversationRenderChild = (
  value: unknown
): value is ConversationRenderChild => z.function().safeParse(value).success;

const isConversationLeafChild = (value: unknown): value is React.ReactNode =>
  !isConversationRenderChild(value);

const parseConversationRenderChild = (
  children: ConversationProps["children"]
) => {
  const parsedRenderer = z
    .custom<ConversationRenderChild>(isConversationRenderChild)
    .safeParse(children);

  if (!parsedRenderer.success) return undefined;

  return parsedRenderer.data;
};

const parseConversationLeafChild = (
  children: ConversationProps["children"]
) => {
  const parsedLeaf = z
    .custom<React.ReactNode>(isConversationLeafChild)
    .safeParse(children);

  if (!parsedLeaf.success) return null;

  return parsedLeaf.data;
};

const conversationInitialScroll = (
  initial: ConversationProps["initial"],
  scrollRestorationKey: string | undefined
) => {
  if (initial !== undefined) return initial;

  if (scrollRestorationKey === undefined) return "smooth";

  return false;
};

function ConversationScrollRestorationSlot({
  storageKey,
}: {
  readonly storageKey: string | undefined;
}) {
  if (storageKey === undefined) return null;

  return <ConversationScrollRestoration storageKey={storageKey} />;
}

function useConversationRenderChild(
  children: ConversationProps["children"],
  scrollRestorationKey: string | undefined
) {
  const renderChild = parseConversationRenderChild(children);

  return useCallback(
    (context: Parameters<ConversationRenderChild>[0]) => {
      if (!renderChild) return null;

      return (
        <>
          {renderChild(context)}
          <ConversationScrollRestorationSlot
            storageKey={scrollRestorationKey}
          />
        </>
      );
    },
    [renderChild, scrollRestorationKey]
  );
}

export const Conversation = ({
  children,
  className,
  initial,
  scrollRestorationKey,
  ...props
}: ConversationProps) => {
  const renderChild = parseConversationRenderChild(children);
  const render = useConversationRenderChild(children, scrollRestorationKey);

  if (renderChild) {
    return (
      <StickToBottom
        className={cn("relative flex-1 overflow-y-hidden", className)}
        initial={conversationInitialScroll(initial, scrollRestorationKey)}
        resize="smooth"
        role="log"
        {...props}
      >
        {render}
      </StickToBottom>
    );
  }

  const leafChildren = parseConversationLeafChild(children);

  return (
    <StickToBottom
      className={cn("relative flex-1 overflow-y-hidden", className)}
      initial={conversationInitialScroll(initial, scrollRestorationKey)}
      resize="smooth"
      role="log"
      {...props}
    >
      {leafChildren}
      <ConversationScrollRestorationSlot storageKey={scrollRestorationKey} />
    </StickToBottom>
  );
};

function restoreScrollPosition(
  scrollElement: HTMLElement,
  storageKey: string,
  scrollToBottom: ReturnType<typeof useStickToBottomContext>["scrollToBottom"]
) {
  const saved = readScrollPosition(sessionStorage.getItem(storageKey));

  if (saved?.atBottom === false) {
    scrollElement.scrollTop = saved.scrollTop;
    requestAnimationFrame(() => {
      scrollElement.scrollTop = saved.scrollTop;
    });

    return;
  }

  scrollElement.scrollTop = scrollElement.scrollHeight;
  void scrollToBottom({ animation: "instant", ignoreEscapes: true });
}

function createScrollSaveHandlers(
  scrollElement: HTMLElement,
  storageKey: string,
  state: ReturnType<typeof useStickToBottomContext>["state"]
) {
  const saveNow = () => {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        atBottom: state.isAtBottom || state.isNearBottom,
        scrollTop: scrollElement.scrollTop,
      })
    );
  };

  let frame: number | undefined;

  const scheduleSave = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      saveNow();
    });
  };

  const cleanup = () => {
    scrollElement.removeEventListener("scroll", scheduleSave);
    window.removeEventListener("pagehide", saveNow);

    if (frame !== undefined) cancelAnimationFrame(frame);
    saveNow();
  };

  scrollElement.addEventListener("scroll", scheduleSave, { passive: true });
  window.addEventListener("pagehide", saveNow);

  return cleanup;
}

function useConversationScrollRestoration(storageKey: string) {
  const { scrollRef, scrollToBottom, state } = useStickToBottomContext();
  const restoredKeyRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;

    if (scrollElement === null) return undefined;

    if (restoredKeyRef.current !== storageKey) {
      restoreScrollPosition(scrollElement, storageKey, scrollToBottom);
      restoredKeyRef.current = storageKey;
    }

    return createScrollSaveHandlers(scrollElement, storageKey, state);
  }, [scrollRef, scrollToBottom, state, storageKey]);
}

function ConversationScrollRestoration({
  storageKey,
}: {
  readonly storageKey: string;
}) {
  useConversationScrollRestoration(storageKey);

  return null;
}

function readScrollPosition(value: string | null):
  | {
      readonly atBottom: boolean;
      readonly scrollTop: number;
    }
  | undefined {
  if (value === null) return undefined;

  try {
    const parsed = scrollPositionSchema.safeParse(JSON.parse(value));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

const unsubscribeFromHydration = () => undefined;

const subscribeToHydration = () => unsubscribeFromHydration;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const isReady = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom();
  }, [scrollToBottom]);

  return (
    isReady &&
    !isAtBottom && (
      <Button
        aria-label="Scroll to bottom"
        className={cn(
          "absolute bottom-32 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);

  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
