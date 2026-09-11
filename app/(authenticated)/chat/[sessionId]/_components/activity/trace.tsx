"use client";

import type { SubagentStatus } from "@app/_lib/subagent-sessions";
import { Shimmer } from "@web/components/ai-elements/shimmer";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import {
  defaultMessageReducer,
  type MessageStreamEvent,
  type SubagentCalledStreamEvent,
} from "eve/client";
import type { EveMessage, EveMessageData } from "eve/react";
import { BotIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo } from "react";

import { messageTimestamps } from "../../_lib/message-events";
import { getLatestTurnFailure } from "../../_lib/turn-failure";
import { AgentMessage } from "../conversation/message";

const messageReducer = defaultMessageReducer();

export function SubagentTrace({
  events,
  hasOlder,
  isLoading,
  isLoadingOlder,
  loadOlder,
  streamError,
  status,
  target,
}: {
  readonly events: readonly MessageStreamEvent[];
  readonly hasOlder: boolean;
  readonly isLoading: boolean;
  readonly isLoadingOlder: boolean;
  readonly loadOlder: () => Promise<void>;
  readonly streamError?: string;
  readonly status: SubagentStatus;
  readonly target: SubagentCalledStreamEvent["data"];
}) {
  const data = useMemo(() => reduceTraceMessages(events), [events]);
  const timestamps = useMemo(() => messageTimestamps(events), [events]);
  const turnFailure = useMemo(() => getLatestTurnFailure(events), [events]);
  const presentation = tracePresentation(status, streamError, turnFailure);

  return (
    <section className="py-4">
      <TraceHeader presentation={presentation} targetName={target.name} />
      <div className="space-y-5 py-5">
        <TraceLoadOlderButton
          hasOlder={hasOlder}
          isLoadingOlder={isLoadingOlder}
          loadOlder={loadOlder}
        />
        <TraceMessages
          isRunning={presentation.isRunning}
          messages={data.messages}
          timestamps={timestamps}
        />
        <TraceLoadingShimmer
          isLoading={isLoading}
          isRunning={presentation.isRunning}
          messageCount={data.messages.length}
        />
        <TraceErrorAlert error={presentation.error} />
      </div>
    </section>
  );
}

function reduceTraceMessages(
  events: readonly MessageStreamEvent[]
): EveMessageData {
  return events.reduce(
    (current, event) => messageReducer.reduce(current, event),
    messageReducer.initial()
  );
}

function tracePresentation(
  status: SubagentStatus,
  streamError: string | undefined,
  turnFailure: string | undefined
) {
  const isRunning = status === "starting" || status === "working";
  const error = streamError ?? turnFailure;

  return {
    alertVariant: resolveAlertVariant(error, isRunning),
    badgeVariant: resolveBadgeVariant(error, isRunning),
    error,
    isRunning,
    statusLabel: resolveStatusLabel(error, isRunning, status),
  };
}

function resolveStatusLabel(
  error: string | undefined,
  isRunning: boolean,
  status: SubagentStatus
): string {
  if (error) return "Failed";

  if (isRunning) return "Running";

  return status;
}

function resolveBadgeVariant(
  error: string | undefined,
  isRunning: boolean
): "destructive" | "information" | "secondary" {
  if (error) return "destructive";

  if (isRunning) return "information";

  return "secondary";
}

function resolveAlertVariant(
  error: string | undefined,
  isRunning: boolean
): "destructive" | "information" | "default" {
  if (error) return "destructive";

  if (isRunning) return "information";

  return "default";
}

function TraceHeader({
  presentation,
  targetName,
}: {
  readonly presentation: ReturnType<typeof tracePresentation>;
  readonly targetName: string;
}) {
  return (
    <Alert variant={presentation.alertVariant}>
      <BotIcon />
      <AlertTitle>{targetName} trace</AlertTitle>
      <AlertAction>
        <Badge variant={presentation.badgeVariant}>
          {presentation.statusLabel}
        </Badge>
      </AlertAction>
    </Alert>
  );
}

function TraceLoadOlderButton({
  hasOlder,
  isLoadingOlder,
  loadOlder,
}: {
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly loadOlder: () => Promise<void>;
}) {
  if (!hasOlder) return null;

  return (
    <Button
      className="mx-auto flex"
      disabled={isLoadingOlder}
      onClick={createLoadOlderHandler(loadOlder)}
      size="sm"
      type="button"
      variant="ghost"
    >
      <TraceLoadOlderLabel isLoadingOlder={isLoadingOlder} />
    </Button>
  );
}

function createLoadOlderHandler(loadOlder: () => Promise<void>) {
  return () => {
    void loadOlder();
  };
}

function TraceLoadOlderLabel({
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

function TraceMessages({
  isRunning,
  messages,
  timestamps,
}: {
  readonly isRunning: boolean;
  readonly messages: readonly EveMessage[];
  readonly timestamps: Map<string, string>;
}) {
  return (
    <>
      {messages.map((message, index) => (
        <AgentMessage
          canRespond={false}
          isStreaming={isTraceMessageStreaming(
            isRunning,
            index,
            messages.length
          )}
          key={message.id}
          message={message}
          onInputResponses={ignoreInputResponses}
          timestamp={timestamps.get(message.id)}
        />
      ))}
    </>
  );
}

function isTraceMessageStreaming(
  isRunning: boolean,
  index: number,
  messageCount: number
): boolean {
  return isRunning && index === messageCount - 1;
}

function ignoreInputResponses() {
  return undefined;
}

function TraceLoadingShimmer({
  isLoading,
  isRunning,
  messageCount,
}: {
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly messageCount: number;
}) {
  if (messageCount > 0) return null;

  if (!isLoading && !isRunning) return null;

  return (
    <Shimmer className="type-supporting-body" duration={1}>
      Loading task trace
    </Shimmer>
  );
}

function TraceErrorAlert({ error }: { readonly error: string | undefined }) {
  if (!error) return null;

  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}
