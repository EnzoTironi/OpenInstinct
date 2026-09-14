"use client";

import { useI18n } from "@web/i18n/context";

import type { EveMessage } from "eve/react";
import { useState } from "react";
import { Message, MessageContent } from "@web/components/ai-elements/message";
import { cn } from "@web/components/class-names";
import { AgentMessagePart, partKey } from "./parts";
import type { RespondToAgentInput } from "./types";
import { MessageFeedback } from "./feedback";

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
  const { locale } = useI18n();

  const timestampFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  });

  const fullTimestampFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const [optimisticTimestamp] = useState(() => new Date().toISOString());
  const displayedTimestamp =
    timestamp ?? (message.role === "user" ? optimisticTimestamp : undefined);
  const visibleParts = userVisibleOnly
    ? userVisibleParts(message, sentMessageParts)
    : message.parts;
  const lastTextIndex = visibleParts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1
  );
  const hasAssistantText =
    message.role === "assistant" &&
    visibleParts.some((part) => part.type === "text" && part.text.length > 0);

  if (visibleParts.length === 0) return null;

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {visibleParts.map((part, index) =>
          hasAssistantText && part.type === "reasoning" ? null : (
            <AgentMessagePart
              canRespond={canRespond}
              key={partKey(part, index)}
              onInputResponses={onInputResponses}
              part={part}
              showCaret={
                isStreaming &&
                message.role === "assistant" &&
                index === lastTextIndex
              }
              userVisibleOnly={userVisibleOnly}
            />
          )
        )}
      </MessageContent>
      {hasAssistantText && !isStreaming && (
        <MessageFeedback messageId={message.id} />
      )}
      {displayedTimestamp ? (
        <time
          className={cn(
            "text-muted-foreground",
            message.role === "user" ? "ml-auto pr-1" : "mr-auto"
          )}
          dateTime={displayedTimestamp}
          title={fullTimestampFormatter.format(new Date(displayedTimestamp))}
        >
          <span className="type-caption" suppressHydrationWarning>
            {timestampFormatter.format(new Date(displayedTimestamp))}
          </span>
        </time>
      ) : null}
    </Message>
  );
}

function userVisibleParts(
  message: EveMessage,
  sentMessageParts?: readonly EveMessage["parts"][number][]
) {
  if (message.role === "user") {
    return message.parts.filter(
      (part) => part.type === "text" || part.type === "file"
    );
  }

  const controls = message.parts.filter((part) =>
    part.type === "authorization"
      ? part.state === "required"
      : part.type === "dynamic-tool" &&
        part.toolMetadata?.eve?.inputRequest !== undefined &&
        part.toolMetadata.eve.inputResponse === undefined &&
        (part.state === "input-available" ||
          part.state === "approval-requested")
  );
  return [...(sentMessageParts ?? []), ...controls];
}
