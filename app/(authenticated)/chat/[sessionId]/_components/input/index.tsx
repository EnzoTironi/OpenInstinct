import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@web/components/ai-elements/prompt-input";
import { api } from "@web/trpc/client";
import { useEffect, useMemo, useRef } from "react";

import { messageContent } from "../../../_lib/message-input";
import { hasPendingBackgroundWorker } from "../../_lib/trace-view";
import type { ChatAgent } from "../chat-agent";

type SessionAgent = Pick<
  ChatAgent,
  "cancel" | "data" | "events" | "resume" | "send" | "status"
>;

function isAgentBusy(status: SessionAgent["status"]) {
  return status === "submitted" || status === "streaming";
}

function isAgentRestoring(
  status: SessionAgent["status"],
  messageCount: number
) {
  return status === "resuming" && messageCount === 0;
}

function shouldIgnoreSubmit(
  message: PromptInputMessage,
  status: SessionAgent["status"],
  restoring: boolean
) {
  const empty = message.text.trim().length === 0 && message.files.length === 0;

  return empty || status === "submitted" || restoring;
}

async function waitForBackgroundCatchUp(
  agent: SessionAgent,
  catchUp: Promise<void>
) {
  await Promise.all([agent.cancel().catch(() => undefined), catchUp]);
}

function clearCatchUpRef(
  ref: { current: Promise<void> | undefined },
  catchUp: Promise<void>
) {
  if (ref.current === catchUp) {
    ref.current = undefined;
  }
}

function startBackgroundCatchUp(
  agent: SessionAgent,
  ref: { current: Promise<void> | undefined }
) {
  if (agent.status !== "ready" || ref.current !== undefined) {
    return;
  }

  const catchUp = agent.resume().catch(() => undefined);
  ref.current = catchUp;
  void catchUp.finally(() => {
    clearCatchUpRef(ref, catchUp);
  });
}

export function ChatInput({
  agent,
  sessionId,
}: {
  readonly agent: SessionAgent;
  readonly sessionId?: string;
}) {
  const { mutate: saveChat } = api.chats.save.useMutation();
  const backgroundCatchUp = useRef<Promise<void> | undefined>(undefined);
  const isBusy = isAgentBusy(agent.status);

  const isRestoring = isAgentRestoring(
    agent.status,
    agent.data.messages.length
  );

  const hasPendingWorker = useMemo(
    () => hasPendingBackgroundWorker(agent.events),
    [agent.events]
  );

  useEffect(() => {
    if (sessionId === undefined || !hasPendingWorker) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      startBackgroundCatchUp(agent, backgroundCatchUp);
    }, 750);

    return () => {
      window.clearInterval(interval);
    };
  }, [agent, hasPendingWorker, sessionId]);

  const handleSubmit = async (message: PromptInputMessage) => {
    if (shouldIgnoreSubmit(message, agent.status, isRestoring)) {
      return;
    }

    const catchUp = backgroundCatchUp.current;

    if (catchUp !== undefined) {
      await waitForBackgroundCatchUp(agent, catchUp);
    }

    if (sessionId !== undefined) {
      saveChat({ sessionId });
    }

    const steer =
      isBusy || catchUp !== undefined
        ? { turnPolicy: "steer" as const }
        : undefined;

    await agent.send(messageContent(message), steer);
  };

  return (
    <div className="absolute bottom-0 left-1/2 z-20 mx-auto w-full max-w-3xl -translate-x-1/2 bg-linear-to-t from-background via-background to-transparent px-4 pt-4 pb-6 sm:px-6">
      <PromptInput compact onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-0"
            disabled={agent.status === "submitted"}
            placeholder="Send a message…"
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit
            disabled={isRestoring}
            onStop={() => {
              void agent.cancel();
            }}
            status={isBusy ? agent.status : undefined}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
