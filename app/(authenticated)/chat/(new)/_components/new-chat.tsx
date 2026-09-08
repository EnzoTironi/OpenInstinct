"use client";

import { useEveAgent } from "eve/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@web/components/ui/button";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@web/components/ai-elements/prompt-input";
import { chatTitle, messageContent } from "../../_lib/message-input";
import { api } from "@web/trpc/client";

export function NewChat() {
  const router = useRouter();
  const { mutateAsync: saveChat } = api.chats.save.useMutation();
  const pendingTitle = useRef<string | undefined>(undefined);
  const isSubmitting = useRef(false);
  const navigationStarted = useRef(false);
  const sendFailed = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const agent = useEveAgent({
    onError() {
      sendFailed.current = true;
      setSendError(true);
    },
    onSessionChange(session) {
      if (session === undefined || navigationStarted.current) return;
      navigationStarted.current = true;
      const path = `/chat/${encodeURIComponent(session.sessionId)}`;
      void saveChat({
        sessionId: session.sessionId,
        title: pendingTitle.current,
      })
        .catch(() => undefined)
        .then(() => {
          router.replace(path);
          return undefined;
        });
      pendingTitle.current = undefined;
    },
  });

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (
      (text.length === 0 && message.files.length === 0) ||
      isSubmitting.current ||
      navigationStarted.current
    ) {
      return;
    }
    isSubmitting.current = true;
    setSending(true);
    setSendError(false);
    sendFailed.current = false;
    pendingTitle.current = chatTitle(message);
    try {
      await agent.send(messageContent(message));
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Eve's onError callback updates this ref while send awaits.
      if (sendFailed.current) {
        throw new Error("Unable to open the conversation");
      }
    } catch (error) {
      setSendError(true);
      throw error;
    } finally {
      isSubmitting.current = false;
      setSending(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      <PromptInput compact onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Message Companion"
            className="min-h-0"
            disabled={sending}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            placeholder="Tell me what you have in mind…"
            ref={inputRef}
            value={draft}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit
            aria-label={sending ? "Sending message" : "Send message"}
            disabled={sending}
            status={sending ? "submitted" : undefined}
          />
        </PromptInputFooter>
      </PromptInput>
      {sendError ? (
        <p className="type-caption text-destructive" role="alert">
          We couldn’t open your conversation. Your draft is still here. Check
          your connection and try again.
        </p>
      ) : null}
      <div
        aria-label="Ideas to get started"
        className="flex flex-wrap justify-center gap-2"
      >
        {[
          {
            label: "Think it through",
            text: "Help me think through a decision. Ask me what I’m weighing up.",
          },
          {
            label: "Remember a preference",
            text: "I’d like you to remember a preference. Ask me what matters.",
          },
          {
            label: "Plan a reminder",
            text: "Help me set a reminder. Ask me what it’s for and when I need it.",
          },
        ].map(({ label, text }) => (
          <Button
            key={label}
            disabled={sending}
            onClick={() => {
              setDraft(text);
              inputRef.current?.focus();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-center type-caption text-muted-foreground">
        Choose an idea to edit it before sending.
      </p>
    </div>
  );
}
