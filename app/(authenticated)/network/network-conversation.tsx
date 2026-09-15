"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowUpIcon, MessageCircleIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { MessageResponse } from "@web/components/ai-elements/message";
import styles from "../space/rooms/rooms.module.css";

export function NetworkConversation({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const query = api.workspaces.network.conversations.messages.useQuery(
    { id },
    { retry: false, refetchInterval: (q) => (q.state.error ? false : 2000) }
  );
  const send = api.workspaces.network.conversations.send.useMutation();
  const close = api.workspaces.network.conversations.close.useMutation({
    onSuccess: onBack,
  });
  const [text, setText] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const end = useRef<HTMLDivElement>(null);
  const messages = query.error ? undefined : query.data?.messages;
  useEffect(() => {
    if (messages?.length) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages?.length]);
  return (
    <div className={styles.conversation}>
      <div className={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Voltar")}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="type-heading-sm">{query.data?.name ?? t("Conversa")}</h1>
      </div>
      <small className={styles.hint}>
        {query.data
          ? t(
              query.data.network === "personal"
                ? "Rede pessoal"
                : "Rede da empresa"
            )
          : t("Carregando…")}
      </small>
      <div
        className={styles.messages}
        role="log"
        aria-live="polite"
        aria-label={t("Mensagens")}
        data-private
      >
        {!query.isPending && !query.error && !messages?.length && (
          <div className={styles.empty}>
            <MessageCircleIcon />
            <p>{t("A conversa começa aqui.")}</p>
          </div>
        )}
        {messages?.map((message) => (
          <article
            key={message.id}
            className={styles.message}
            data-mine={!message.fromBot}
          >
            <small>{message.fromBot ? query.data?.name : t("Você")}</small>
            {message.fromBot ? (
              <MessageResponse>{message.text}</MessageResponse>
            ) : (
              <p>{message.text}</p>
            )}
          </article>
        ))}
        <div ref={end} />
      </div>
      {query.error && (
        <p role="alert">
          {t("Esta conversa não está mais disponível para você.")}
        </p>
      )}
      {(send.error ?? close.error) && (
        <p role="alert">{t("Não foi possível concluir. Tente novamente.")}</p>
      )}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate(
            { id, text: text.trim(), operationId },
            {
              onSuccess: () => {
                setText("");
                setOperationId(crypto.randomUUID());
                void query.refetch();
              },
            }
          );
        }}
      >
        <Input
          data-private
          aria-label={t("Mensagem")}
          placeholder={t("Mensagem")}
          value={text}
          maxLength={8000}
          disabled={!!query.error || send.isPending}
          onChange={(event) => {
            setText(event.target.value);
            setOperationId(crypto.randomUUID());
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={t("Enviar mensagem")}
          disabled={!text.trim() || !!query.error || send.isPending}
        >
          <ArrowUpIcon />
        </Button>
      </form>
      <details>
        <summary>{t("Encerrar conversa")}</summary>
        <p>
          {t("Novas mensagens e tarefas desta conversa serão interrompidas.")}
        </p>
        <Button
          variant="destructive"
          disabled={close.isPending}
          onClick={() => {
            close.mutate({ id });
          }}
        >
          {t("Encerrar")}
        </Button>
      </details>
    </div>
  );
}
