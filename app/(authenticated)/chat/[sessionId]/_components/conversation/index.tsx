import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@web/components/ai-elements/conversation";
import { Message, MessageContent } from "@web/components/ai-elements/message";
import { Shimmer } from "@web/components/ai-elements/shimmer";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import type { InputResponse, MessageStreamEvent } from "eve/client";
import type { EveMessage, EveMessagePart } from "eve/react";
import { AlertCircleIcon, BrainIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo } from "react";

import {
  imessageTimestamps,
  messageTimestamps,
  sentMessages,
} from "../../_lib/message-events";
import { messagesForTraceView, type TraceView } from "../../_lib/trace-view";
import { getLatestTurnFailure } from "../../_lib/turn-failure";
import type { ChatAgent } from "../chat-agent";
import { AgentMessage } from "./message";

type ConversationAgent = Pick<
  ChatAgent,
  "data" | "error" | "events" | "respond" | "status"
>;

interface SentDelivery {
  readonly id: string;
  readonly parts: EveMessagePart[];
  readonly timestamp: string;
}

export function ChatConversation({
  agent,
  history,
  initial,
  sessionId,
  traceView,
}: {
  readonly agent: ConversationAgent;
  readonly history?: {
    readonly hasOlder: boolean;
    readonly isLoadingOlder: boolean;
    readonly loadOlder: () => Promise<void>;
  };
  readonly initial?: false;
  readonly sessionId?: string;
  readonly traceView: TraceView;
}) {
  const messages = useMemo(
    () => messagesForTraceView(agent.data.messages, agent.events, traceView),
    [agent.data.messages, agent.events, traceView]
  );

  const timestamps = useMemo(
    () => timestampsForView(agent.events, traceView),
    [agent.events, traceView]
  );

  const deliveredMessages = useMemo(
    () => sentMessages(agent.events),
    [agent.events]
  );

  const viewModel = conversationViewModel(agent, messages, traceView);

  return (
    <Conversation
      className="min-h-0 flex-1"
      initial={initial}
      resize={conversationResize(sessionId)}
      scrollRestorationKey={scrollRestorationKey(
        agent.data.messages.length,
        sessionId
      )}
    >
      <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-6 pb-36 sm:px-6">
        <LoadOlderButton history={history} />
        <RestoringShimmer
          isRestoring={viewModel.isRestoring}
          messageCount={messages.length}
        />
        <ConversationMessages
          agent={agent}
          deliveredMessages={deliveredMessages}
          isBusy={viewModel.isBusy}
          messages={messages}
          pendingAssistantMessageId={viewModel.pendingAssistantMessageId}
          showPendingThinking={viewModel.showPendingThinking}
          timestamps={timestamps}
          traceView={traceView}
        />
        <PendingThinkingSlot show={viewModel.showPendingThinking} />
        <ErrorMessageSlot
          message={viewModel.errorMessage}
          traceView={traceView}
        />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function conversationViewModel(
  agent: ConversationAgent,
  messages: readonly EveMessage[],
  traceView: TraceView
) {
  const isBusy = isAgentBusy(agent.status);

  const isRestoring = isAgentRestoring(
    agent.status,
    agent.data.messages.length
  );

  const pendingAssistantMessageId = resolvePendingAssistantMessageId(
    agent.data.messages.at(-1)
  );

  const showPendingThinking = shouldShowPendingThinking({
    isBusy,
    lastMessageRole: agent.data.messages.at(-1)?.role,
    pendingAssistantMessageId,
    status: agent.status,
    traceView,
  });

  const errorMessage = resolveErrorMessage({
    error: agent.error,
    events: agent.events,
    isBusy,
    isRestoring,
  });

  return {
    errorMessage,
    isBusy,
    isRestoring,
    pendingAssistantMessageId,
    showPendingThinking,
  };
}

function isAgentBusy(status: ConversationAgent["status"]): boolean {
  return status === "submitted" || status === "streaming";
}

function isAgentRestoring(
  status: ConversationAgent["status"],
  messageCount: number
): boolean {
  return status === "resuming" && messageCount === 0;
}

function resolvePendingAssistantMessageId(
  lastMessage: EveMessage | undefined
): string | undefined {
  if (!lastMessage) return undefined;

  if (lastMessage.role !== "assistant") return undefined;

  if (!lastMessage.parts.every(isStepStartPart)) return undefined;

  return lastMessage.id;
}

function isStepStartPart(part: EveMessagePart): boolean {
  return part.type === "step-start";
}

function shouldShowPendingThinking({
  isBusy,
  lastMessageRole,
  pendingAssistantMessageId,
  status,
  traceView,
}: {
  readonly isBusy: boolean;
  readonly lastMessageRole: EveMessage["role"] | undefined;
  readonly pendingAssistantMessageId: string | undefined;
  readonly status: ConversationAgent["status"];
  readonly traceView: TraceView;
}): boolean {
  if (traceView !== "trace") return false;

  if (!isBusy) return false;

  return (
    status === "submitted" ||
    lastMessageRole !== "assistant" ||
    pendingAssistantMessageId !== undefined
  );
}

function resolveErrorMessage({
  error,
  events,
  isBusy,
  isRestoring,
}: {
  readonly error: ConversationAgent["error"];
  readonly events: ConversationAgent["events"];
  readonly isBusy: boolean;
  readonly isRestoring: boolean;
}): string | undefined {
  if (isBusy || isRestoring) {
    return error ? toErrorMessage(error) : undefined;
  }

  const turnFailure = getLatestTurnFailure(events);

  if (error) return toErrorMessage(error);

  return turnFailure;
}

function timestampsForView(
  events: readonly MessageStreamEvent[],
  traceView: TraceView
) {
  if (traceView === "imessage") return imessageTimestamps(events);

  return messageTimestamps(events);
}

function conversationResize(sessionId: string | undefined) {
  if (sessionId === undefined) return "smooth";

  return "instant";
}

function scrollRestorationKey(
  messageCount: number,
  sessionId: string | undefined
): string | undefined {
  if (messageCount === 0) return undefined;

  if (sessionId === undefined) return undefined;

  return `eve:web-chat-scroll:${sessionId}`;
}

function LoadOlderButton({
  history,
}: {
  readonly history?: {
    readonly hasOlder: boolean;
    readonly isLoadingOlder: boolean;
    readonly loadOlder: () => Promise<void>;
  };
}) {
  if (!history?.hasOlder) return null;

  return (
    <Button
      className="self-center"
      disabled={history.isLoadingOlder}
      onClick={createLoadOlderHandler(history.loadOlder)}
      size="sm"
      type="button"
      variant="ghost"
    >
      <LoadOlderLabel isLoadingOlder={history.isLoadingOlder} />
    </Button>
  );
}

function createLoadOlderHandler(loadOlder: () => Promise<void>) {
  return () => {
    void loadOlder();
  };
}

function LoadOlderLabel({
  isLoadingOlder,
}: {
  readonly isLoadingOlder: boolean;
}) {
  if (isLoadingOlder) {
    return (
      <>
        <LoaderCircleIcon className="animate-spin" />
        Loading…
      </>
    );
  }

  return "Load older messages";
}

function RestoringShimmer({
  isRestoring,
  messageCount,
}: {
  readonly isRestoring: boolean;
  readonly messageCount: number;
}) {
  if (!isRestoring) return null;

  if (messageCount > 0) return null;

  return (
    <Shimmer className="type-supporting-body self-center" duration={1}>
      Loading recent messages
    </Shimmer>
  );
}

function ConversationMessages({
  agent,
  deliveredMessages,
  isBusy,
  messages,
  pendingAssistantMessageId,
  showPendingThinking,
  timestamps,
  traceView,
}: {
  readonly agent: ConversationAgent;
  readonly deliveredMessages: Map<string, SentDelivery[]>;
  readonly isBusy: boolean;
  readonly messages: readonly EveMessage[];
  readonly pendingAssistantMessageId: string | undefined;
  readonly showPendingThinking: boolean;
  readonly timestamps: Map<string, string>;
  readonly traceView: TraceView;
}) {
  return (
    <>
      {messages.map((message, index) => (
        <ConversationMessageItem
          agent={agent}
          deliveredMessages={deliveredMessages}
          index={index}
          isBusy={isBusy}
          key={message.id}
          message={message}
          messageCount={messages.length}
          pendingAssistantMessageId={pendingAssistantMessageId}
          showPendingThinking={showPendingThinking}
          timestamps={timestamps}
          traceView={traceView}
        />
      ))}
    </>
  );
}

function ConversationMessageItem({
  agent,
  deliveredMessages,
  index,
  isBusy,
  message,
  messageCount,
  pendingAssistantMessageId,
  showPendingThinking,
  timestamps,
  traceView,
}: {
  readonly agent: ConversationAgent;
  readonly deliveredMessages: Map<string, SentDelivery[]>;
  readonly index: number;
  readonly isBusy: boolean;
  readonly message: EveMessage;
  readonly messageCount: number;
  readonly pendingAssistantMessageId: string | undefined;
  readonly showPendingThinking: boolean;
  readonly timestamps: Map<string, string>;
  readonly traceView: TraceView;
}) {
  if (showPendingThinking && message.id === pendingAssistantMessageId) {
    return null;
  }

  const deliveries =
    traceView === "imessage" ? deliveredMessages.get(message.id) : undefined;

  if (deliveries) {
    return (
      <DeliveredMessageGroup
        agent={agent}
        deliveries={deliveries}
        isBusy={isBusy}
        message={message}
      />
    );
  }

  return (
    <AgentMessage
      canRespond={canRespondWhileIdle(isBusy, agent.status)}
      isStreaming={isLastStreamingMessage(agent.status, index, messageCount)}
      key={message.id}
      message={message}
      onInputResponses={createRespondHandler(agent)}
      timestamp={timestamps.get(message.id)}
      userVisibleOnly={traceView === "imessage"}
    />
  );
}

function DeliveredMessageGroup({
  agent,
  deliveries,
  isBusy,
  message,
}: {
  readonly agent: ConversationAgent;
  readonly deliveries: readonly SentDelivery[];
  readonly isBusy: boolean;
  readonly message: EveMessage;
}) {
  const canRespond = canRespondWhileIdle(isBusy, agent.status);
  const onInputResponses = createRespondHandler(agent);

  return (
    <>
      {deliveries.map((delivery) => (
        <AgentMessage
          canRespond={canRespond}
          isStreaming={false}
          key={delivery.id}
          message={{ ...message, id: delivery.id, parts: [] }}
          onInputResponses={onInputResponses}
          sentMessageParts={delivery.parts}
          timestamp={delivery.timestamp}
          userVisibleOnly
        />
      ))}
      <AgentMessage
        canRespond={canRespond}
        isStreaming={false}
        message={message}
        onInputResponses={onInputResponses}
        userVisibleOnly
      />
    </>
  );
}

function canRespondWhileIdle(
  isBusy: boolean,
  status: ConversationAgent["status"]
): boolean {
  return !isBusy && status !== "resuming";
}

function isLastStreamingMessage(
  status: ConversationAgent["status"],
  index: number,
  messageCount: number
): boolean {
  return status === "streaming" && index === messageCount - 1;
}

function createRespondHandler(agent: ConversationAgent) {
  return (responses: readonly InputResponse[]) => agent.respond(responses);
}

function PendingThinkingSlot({ show }: { readonly show: boolean }) {
  if (!show) return null;

  return <PendingThinking />;
}

function ErrorMessageSlot({
  message,
  traceView,
}: {
  readonly message: string | undefined;
  readonly traceView: TraceView;
}) {
  if (traceView !== "trace") return null;

  if (!message) return null;

  return <ErrorMessage message={message} />;
}

function toErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Unable to complete the request.";

  if (/<!doctype html|<html[\s>]/i.test(cause.message)) {
    return "The agent runtime is unavailable. Try again in a moment.";
  }

  return cause.message;
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </MessageContent>
    </Message>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="type-supporting-body mb-4 flex w-full items-center gap-2 text-muted-foreground">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}
