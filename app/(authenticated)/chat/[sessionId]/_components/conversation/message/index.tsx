"use client";

import { Message, MessageContent } from "@web/components/ai-elements/message";
import { cn } from "@web/components/class-names";
import type { EveMessage, EveMessagePart } from "eve/react";
import { useState } from "react";

import { AgentMessagePart, partKey } from "./parts";
import type { RespondToAgentInput } from "./types";

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
  sentMessageParts,
  timestamp,
  userVisibleOnly = false,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: RespondToAgentInput;
  readonly sentMessageParts?: readonly EveMessage["parts"][number][];
  readonly timestamp?: string;
  readonly userVisibleOnly?: boolean;
}) {
  const [optimisticTimestamp] = useState(createOptimisticTimestamp);

  const displayedTimestamp = resolveDisplayedTimestamp(
    timestamp,
    message.role,
    optimisticTimestamp
  );

  const visibleParts = userVisibleOnly
    ? userVisibleParts(message, sentMessageParts)
    : message.parts;

  const lastTextIndex = findLastTextIndex(visibleParts);

  const hasAssistantText = assistantHasText(message.role, visibleParts);

  if (visibleParts.length === 0) return null;

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {visibleParts.map((part, index) => (
          <AgentMessagePartSlot
            canRespond={canRespond}
            hasAssistantText={hasAssistantText}
            index={index}
            isStreaming={isStreaming}
            key={partKey(part, index)}
            lastTextIndex={lastTextIndex}
            messageRole={message.role}
            onInputResponses={onInputResponses}
            part={part}
            userVisibleOnly={userVisibleOnly}
          />
        ))}
      </MessageContent>
      <AgentMessageTimestamp
        displayedTimestamp={displayedTimestamp}
        role={message.role}
      />
    </Message>
  );
}

function createOptimisticTimestamp() {
  return new Date().toISOString();
}

function resolveDisplayedTimestamp(
  timestamp: string | undefined,
  role: EveMessage["role"],
  optimisticTimestamp: string
): string | undefined {
  if (timestamp !== undefined) {
    return timestamp;
  }

  if (role === "user") {
    return optimisticTimestamp;
  }

  return undefined;
}

function findLastTextIndex(parts: readonly EveMessagePart[]): number {
  return parts.reduce(updateLastTextIndex, -1);
}

function updateLastTextIndex(
  last: number,
  part: EveMessagePart,
  index: number
): number {
  if (part.type === "text") {
    return index;
  }

  return last;
}

function assistantHasText(
  role: EveMessage["role"],
  parts: readonly EveMessagePart[]
): boolean {
  if (role !== "assistant") {
    return false;
  }

  return parts.some(isNonEmptyTextPart);
}

function isNonEmptyTextPart(part: EveMessagePart): boolean {
  return part.type === "text" && part.text.length > 0;
}

function AgentMessagePartSlot({
  canRespond,
  hasAssistantText,
  index,
  isStreaming,
  lastTextIndex,
  messageRole,
  onInputResponses,
  part,
  userVisibleOnly,
}: {
  readonly canRespond: boolean;
  readonly hasAssistantText: boolean;
  readonly index: number;
  readonly isStreaming: boolean;
  readonly lastTextIndex: number;
  readonly messageRole: EveMessage["role"];
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveMessagePart;
  readonly userVisibleOnly: boolean;
}) {
  if (hasAssistantText && part.type === "reasoning") {
    return null;
  }

  return (
    <AgentMessagePart
      canRespond={canRespond}
      onInputResponses={onInputResponses}
      part={part}
      showCaret={shouldShowCaret(
        isStreaming,
        messageRole,
        index,
        lastTextIndex
      )}
      userVisibleOnly={userVisibleOnly}
    />
  );
}

function shouldShowCaret(
  isStreaming: boolean,
  role: EveMessage["role"],
  index: number,
  lastTextIndex: number
): boolean {
  return isStreaming && role === "assistant" && index === lastTextIndex;
}

function AgentMessageTimestamp({
  displayedTimestamp,
  role,
}: {
  readonly displayedTimestamp: string | undefined;
  readonly role: EveMessage["role"];
}) {
  if (!displayedTimestamp) {
    return null;
  }

  return (
    <time
      className={cn(
        "text-muted-foreground",
        role === "user" ? "ml-auto pr-1" : "mr-auto"
      )}
      dateTime={displayedTimestamp}
      title={fullTimestampFormatter.format(new Date(displayedTimestamp))}
    >
      <span className="type-caption" suppressHydrationWarning>
        {timestampFormatter.format(new Date(displayedTimestamp))}
      </span>
    </time>
  );
}

function userVisibleParts(
  message: EveMessage,
  sentMessageParts?: readonly EveMessage["parts"][number][]
) {
  if (message.role === "user") {
    return message.parts.filter(isUserVisibleUserPart);
  }

  const controls = message.parts.filter(isUserVisibleControlPart);

  return [...(sentMessageParts ?? []), ...controls];
}

function isUserVisibleUserPart(part: EveMessagePart): boolean {
  return part.type === "text" || part.type === "file";
}

function isUserVisibleControlPart(part: EveMessagePart): boolean {
  if (part.type === "authorization") {
    return part.state === "required";
  }

  if (part.type !== "dynamic-tool") {
    return false;
  }

  const eve = part.toolMetadata?.eve;

  if (eve?.inputRequest === undefined) {
    return false;
  }

  if (eve.inputResponse !== undefined) {
    return false;
  }

  return (
    part.state === "input-available" || part.state === "approval-requested"
  );
}

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const fullTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
