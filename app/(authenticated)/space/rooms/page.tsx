"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowUpIcon, HashIcon, PlusIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import shared from "../space.module.css";
import styles from "./rooms.module.css";

export default function RoomsPage() {
  const { t } = useI18n();
  const rooms = api.workspaces.rooms.list.useQuery();
  const create = api.workspaces.rooms.create.useMutation();
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createOperation, setCreateOperation] = useState(() =>
    crypto.randomUUID()
  );
  if (selected)
    return (
      <RoomConversation
        key={selected}
        id={selected}
        mayManage={!!rooms.data?.mayManage}
        onClose={() => {
          setSelected(undefined);
          void rooms.refetch();
        }}
      />
    );
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-together.jpg"
        title={t("Uma conversa. Toda a equipe.")}
      />
      {rooms.isPending && <output>{t("Carregando…")}</output>}
      {rooms.data?.configured === false && (
        <p className={shared.empty}>
          {t("As salas ainda não estão disponíveis.")}
        </p>
      )}
      <div className={shared.list}>
        {rooms.data?.rooms.map((room) => (
          <button
            type="button"
            key={room.id}
            className={shared.row}
            onClick={() => {
              setSelected(room.id);
            }}
          >
            <HashIcon />
            <span>
              {room.label}
              <small>{t("Compartilhada com este espaço")}</small>
            </span>
          </button>
        ))}
      </div>
      {rooms.data?.configured && rooms.data.mayManage && !creating && (
        <div className={shared.actions}>
          <Button
            variant="outline"
            onClick={() => {
              setCreating(true);
            }}
          >
            <PlusIcon />
            {t("Criar sala")}
          </Button>
        </div>
      )}
      {creating && (
        <form
          className={shared.create}
          onSubmit={(event) => {
            event.preventDefault();
            void create
              .mutateAsync({ name: name.trim(), operationId: createOperation })
              .then(async (room) => {
                await rooms.refetch();
                setSelected(room.id);
                setCreating(false);
                setName("");
                setCreateOperation(crypto.randomUUID());
                return undefined;
              })
              .catch(() => undefined);
          }}
        >
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder={t("Nome da sala")}
            aria-label={t("Nome da sala")}
            maxLength={80}
            required
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {t("Criar sala")}
          </Button>
        </form>
      )}
      {(rooms.error ?? create.error) && (
        <p role="alert">
          {t("Não foi possível abrir a sala. Tente novamente.")}
        </p>
      )}
    </div>
  );
}

function RoomConversation({
  id,
  mayManage,
  onClose,
}: {
  id: string;
  mayManage: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const query = api.workspaces.rooms.messages.useQuery(
    { id },
    { refetchInterval: 3000, retry: false }
  );
  const send = api.workspaces.rooms.send.useMutation();
  const close = api.workspaces.rooms.close.useMutation();
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
          onClick={onClose}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="type-heading-sm">
          {query.data?.room.label ?? t("Sala da equipe")}
        </h1>
      </div>
      <div
        className={styles.messages}
        role="log"
        aria-live="polite"
        aria-label={t("Mensagens da equipe")}
      >
        {query.isPending && <output>{t("Carregando…")}</output>}
        {!query.isPending && !query.error && !messages?.length && (
          <div className={styles.empty}>
            <HashIcon />
            <p>{t("A conversa começa aqui.")}</p>
            <small>{t("Mencione Zoen quando precisar de ajuda.")}</small>
          </div>
        )}
        {messages?.map((message) => (
          <article
            key={message.id}
            className={styles.message}
            data-mine={message.mine}
          >
            <small>{message.sender}</small>
            <p>{message.text}</p>
          </article>
        ))}
        <div ref={end} />
      </div>
      {query.error && (
        <p role="alert">{t("Esta sala não está mais disponível para você.")}</p>
      )}
      {send.error && (
        <p role="alert">{t("Não foi possível enviar. Tente novamente.")}</p>
      )}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void send
            .mutateAsync({ id, text: text.trim(), operationId })
            .then(async () => {
              setText("");
              setOperationId(crypto.randomUUID());
              await query.refetch();
              return undefined;
            })
            .catch(() => undefined);
        }}
      >
        <Input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOperationId(crypto.randomUUID());
          }}
          placeholder={t("Mensagem · @Zoen")}
          aria-label={t("Mensagem")}
          maxLength={8000}
          disabled={!!query.error || send.isPending}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || send.isPending || !!query.error}
          aria-label={t("Enviar mensagem")}
        >
          <ArrowUpIcon />
        </Button>
      </form>
      {mayManage && (
        <details>
          <summary className={shared.row}>{t("Encerrar sala")}</summary>
          <p>{t("Esta sala deixará de receber mensagens.")}</p>
          <Button
            variant="destructive"
            disabled={close.isPending}
            onClick={() => {
              void close
                .mutateAsync({ id })
                .then(() => {
                  onClose();
                  return undefined;
                })
                .catch(() => undefined);
            }}
          >
            {t("Encerrar para todos")}
          </Button>
          {close.error && (
            <p role="alert">
              {t("Não foi possível abrir a sala. Tente novamente.")}
            </p>
          )}
        </details>
      )}
      <small className={styles.hint}>
        {t("Compartilhada com este espaço")}
      </small>
    </div>
  );
}
