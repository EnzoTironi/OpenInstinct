"use client";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@web/components/ai-elements/prompt-input";
import { Button } from "@web/components/ui/button";
import { api } from "@web/trpc/client";
import { useEveAgent } from "eve/react";
import { useRouter } from "next/navigation";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";

import { chatTitle, messageContent } from "../../_lib/message-input";
import { chatStarters } from "../_lib/starters";

export function NewChat({
  initialDraft = "",
}: {
  readonly initialDraft?: string;
}) {
  const router = useRouter();
  const { mutateAsync: saveChat } = api.chats.save.useMutation();
  const pendingTitle = useRef<string | undefined>(undefined);
  const isSubmitting = useRef(false);
  const navigationStarted = useRef(false);
  const sendFailed = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  const agent = useEveAgent({
    onError() {
      sendFailed.current = true;
      setSendError(true);
    },
    onSessionChange(session) {
      navigateToSession(
        session,
        navigationStarted,
        pendingTitle,
        saveChat,
        router
      );
    },
  });

  return (
    <div className="w-full space-y-4">
      <PromptInput
        compact
        onSubmit={async (message) => {
          await submitNewChat(
            message,
            agent,
            isSubmitting,
            navigationStarted,
            pendingTitle,
            sendFailed,
            setSending,
            setSendError
          );
        }}
      >
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
            aria-label={submitAriaLabel(sending)}
            disabled={sending}
            status={submitStatus(sending)}
          />
        </PromptInputFooter>
      </PromptInput>
      <SendErrorMessage sendError={sendError} />
      <StarterIdeas inputRef={inputRef} sending={sending} setDraft={setDraft} />
      <p className="text-center type-caption text-muted-foreground">
        Choose an idea to edit it before sending.
      </p>
    </div>
  );
}

function navigateToSession(
  session: { sessionId: string } | undefined,
  navigationStarted: { current: boolean },
  pendingTitle: { current: string | undefined },
  saveChat: (input: {
    sessionId: string;
    title: string | undefined;
  }) => Promise<void>,
  router: ReturnType<typeof useRouter>
) {
  if (session === undefined || navigationStarted.current) return;

  navigationStarted.current = true;
  const path = `/chat/${encodeURIComponent(session.sessionId)}`;
  const title = pendingTitle.current;
  pendingTitle.current = undefined;

  void saveChat({ sessionId: session.sessionId, title })
    .catch(ignoreError)
    .then(() => {
      router.replace(path);

      return undefined;
    });
}

function ignoreError() {
  return undefined;
}

async function submitNewChat(
  message: PromptInputMessage,
  agent: {
    send: (content: ReturnType<typeof messageContent>) => Promise<void>;
  },
  isSubmitting: { current: boolean },
  navigationStarted: { current: boolean },
  pendingTitle: { current: string | undefined },
  sendFailed: { current: boolean },
  setSending: Dispatch<SetStateAction<boolean>>,
  setSendError: Dispatch<SetStateAction<boolean>>
) {
  if (shouldSkipNewChatSubmit(message, isSubmitting, navigationStarted)) {
    return;
  }

  isSubmitting.current = true;
  setSending(true);
  setSendError(false);
  sendFailed.current = false;
  pendingTitle.current = chatTitle(message);

  try {
    await agent.send(messageContent(message));
    assertSendSucceeded(sendFailed.current);
  } catch (error) {
    setSendError(true);
    throw error;
  } finally {
    isSubmitting.current = false;
    setSending(false);
  }
}

function shouldSkipNewChatSubmit(
  message: PromptInputMessage,
  isSubmitting: { current: boolean },
  navigationStarted: { current: boolean }
): boolean {
  const text = message.text.trim();
  const empty = text.length === 0 && message.files.length === 0;

  return empty || isSubmitting.current || navigationStarted.current;
}

function assertSendSucceeded(failed: boolean) {
  if (failed) throw new Error("Unable to open the conversation");
}

function submitAriaLabel(sending: boolean): string {
  if (sending) return "Sending message";

  return "Send message";
}

function submitStatus(sending: boolean): "submitted" | undefined {
  if (sending) return "submitted";

  return undefined;
}

function SendErrorMessage({ sendError }: { readonly sendError: boolean }) {
  if (!sendError) return null;

  return (
    <p className="type-caption text-destructive" role="alert">
      We couldn’t open your conversation. Your draft is still here. Check your
      connection and try again.
    </p>
  );
}

function StarterIdeas({
  inputRef,
  sending,
  setDraft,
}: {
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly sending: boolean;
  readonly setDraft: Dispatch<SetStateAction<string>>;
}) {
  return (
    <div
      aria-label="Ideas to get started"
      className="flex flex-wrap justify-center gap-2"
    >
      {chatStarters.map((starter) => (
        <StarterButton
          key={starter.label}
          inputRef={inputRef}
          label={starter.label}
          sending={sending}
          setDraft={setDraft}
          text={starter.text}
        />
      ))}
    </div>
  );
}

function StarterButton({
  inputRef,
  label,
  sending,
  setDraft,
  text,
}: {
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly label: string;
  readonly sending: boolean;
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly text: string;
}) {
  return (
    <Button
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
  );
}
