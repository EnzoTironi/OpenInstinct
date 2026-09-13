"use client";

import { useI18n } from "@web/i18n/context";

import { useEveAgent } from "eve/react";
import { useRouter, useSearchParams } from "next/navigation";
import { workspaceHref } from "@web/workspaces/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
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

export function NewChat({
  initialDraft = "",
}: {
  readonly initialDraft?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const workspaceId = useSearchParams().get("space");
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
    headers: workspaceId ? { "x-zoen-workspace": workspaceId } : {},
    onError() {
      sendFailed.current = true;
      setSendError(true);
    },
    onSessionChange(session) {
      if (session === undefined || navigationStarted.current) return;
      navigationStarted.current = true;
      const path = workspaceHref(
        `/chat/${encodeURIComponent(session.sessionId)}`,
        workspaceId
      );
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
        throw new Error(t("Unable to open the conversation"));
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
            aria-label={t("Mensagem para o Zoen")}
            className="min-h-0"
            disabled={sending}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            placeholder={t("O que está na sua cabeça?")}
            ref={inputRef}
            value={draft}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit
            aria-label={sending ? t("Enviando mensagem") : t("Enviar mensagem")}
            disabled={sending}
            status={sending ? "submitted" : undefined}
          />
        </PromptInputFooter>
      </PromptInput>
      {sendError ? (
        <p className="type-caption text-destructive" role="alert">
          {t(
            "Não foi possível abrir sua conversa. Seu rascunho continua aqui. Verifique a conexão e tente novamente."
          )}
        </p>
      ) : null}
      <p className="text-center type-caption text-muted-foreground">
        {initialDraft ? (
          t("Ajuste o pedido e envie quando quiser.")
        ) : (
          <Link href={workspaceHref("/recipes", workspaceId)}>
            {t("Precisa de uma ideia?")}
          </Link>
        )}
      </p>
    </div>
  );
}
