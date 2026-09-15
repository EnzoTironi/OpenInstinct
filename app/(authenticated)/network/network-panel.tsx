"use client";

import { useState } from "react";
import {
  AtSignIcon,
  CheckIcon,
  ChevronRightIcon,
  UserRoundIcon,
  UserRoundPlusIcon,
  XIcon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { PanelIntro } from "../_components/panel-intro";
import { PanelLink } from "../_components/panel-link";
import { NetworkConversation } from "./network-conversation";
import panel from "../_components/panel.module.css";
import styles from "../_components/connections.module.css";

export function NetworkPanel({ personal }: { personal: boolean }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  const [username, setUsername] = useState("");
  const network = api.workspaces.network.list.useQuery(undefined, {
    enabled: personal,
    refetchInterval: 10_000,
  });
  const conversations = api.workspaces.network.conversations.list.useQuery();
  const bots = api.workspaces.bot.search.useQuery(
    { query },
    { enabled: query === "" || /^[a-z][a-z0-9_]{1,29}$/.test(query) }
  );
  const open = api.workspaces.network.conversations.open.useMutation({
    onSuccess: (c) => {
      setSelected(c.id);
    },
  });
  const refresh = async () => {
    await Promise.all([
      network.refetch(),
      bots.refetch(),
      conversations.refetch(),
    ]);
  };
  const invite = api.workspaces.network.invite.useMutation({
    onSuccess: async () => {
      setUsername("");
      await refresh();
    },
  });
  const answer = api.workspaces.network.answer.useMutation({
    onSuccess: refresh,
  });
  const block = api.workspaces.network.block.useMutation({
    onSuccess: refresh,
  });
  const end = api.workspaces.network.end.useMutation({ onSuccess: refresh });
  const error =
    (personal ? network.error : null) ??
    conversations.error ??
    bots.error ??
    open.error ??
    invite.error ??
    answer.error ??
    block.error ??
    end.error;
  if (selected)
    return (
      <NetworkConversation
        key={selected}
        id={selected}
        onBack={() => {
          setSelected(undefined);
          void conversations.refetch();
        }}
      />
    );
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-together.jpg"
        title={t(personal ? "Minha rede" : "Rede da empresa")}
      />
      <p className={styles.empty}>
        {t(
          personal
            ? "Pessoas de confiança. Cada Zoen no seu espaço."
            : "Converse com os agentes da sua empresa."
        )}
      </p>
      {personal && (
        <details className={styles.group}>
          <summary className={styles.row}>
            <UserRoundPlusIcon />
            {t("Convidar uma pessoa")}
          </summary>
          <form
            className={styles.manage}
            onSubmit={(event) => {
              event.preventDefault();
              invite.mutate({ username });
            }}
          >
            <Input
              aria-label={t("Username da pessoa")}
              placeholder="@username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value.toLowerCase().replace(/^@/, ""));
              }}
              pattern="[a-z][a-z0-9_]{2,29}"
              maxLength={30}
              required
            />
            <Button type="submit" disabled={invite.isPending}>
              {t("Enviar convite")}
            </Button>
          </form>
        </details>
      )}
      {personal &&
        network.data?.invites.map((item) => (
          <div className={styles.row} key={item.id}>
            <UserRoundIcon />
            <span className={styles.copy}>
              @{item.username}
              <small>
                {t(
                  item.direction === "sent"
                    ? "Convite enviado"
                    : "Quer entrar na sua rede"
                )}
              </small>
            </span>
            {item.direction === "received" && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("Aceitar convite")}
                  disabled={answer.isPending}
                  onClick={() => {
                    answer.mutate({ id: item.id, accept: true });
                  }}
                >
                  <CheckIcon />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("Recusar convite")}
                  disabled={answer.isPending}
                  onClick={() => {
                    answer.mutate({ id: item.id, accept: false });
                  }}
                >
                  <XIcon />
                </Button>
              </>
            )}
          </div>
        ))}
      {personal && (
        <div className={styles.list}>
          {network.data?.connections.map((person) => (
            <div key={person.username}>
              <button
                type="button"
                className={styles.row}
                disabled={!person.botUsername || open.isPending}
                onClick={() => {
                  if (person.botUsername)
                    open.mutate({ username: person.botUsername });
                }}
              >
                <span className={styles.icon}>
                  <UserRoundIcon />
                </span>
                <span className={styles.copy}>
                  {person.name}
                  <small>@{person.username}</small>
                </span>
                <ChevronRightIcon className={styles.trailing} />
              </button>
              <details className={styles.manage}>
                <summary>{t("Gerenciar conexão")}</summary>
                <Button
                  variant="outline"
                  disabled={end.isPending}
                  onClick={() => {
                    end.mutate({ username: person.username });
                  }}
                >
                  {t("Remover da rede")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={block.isPending}
                  onClick={() => {
                    block.mutate({ username: person.username });
                  }}
                >
                  {t("Bloquear pessoa")}
                </Button>
              </details>
            </div>
          ))}
        </div>
      )}
      <section className={styles.group} aria-label={t("Encontrar um bot")}>
        <Input
          aria-label={t("Encontrar um bot")}
          placeholder={t("Encontrar um bot")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value.toLowerCase().replace(/^@/, ""));
          }}
          maxLength={30}
        />
        <div className={styles.list}>
          {(!personal || query) &&
            bots.data?.map((bot) => (
              <button
                type="button"
                className={styles.row}
                key={bot.username}
                disabled={open.isPending}
                onClick={() => {
                  open.mutate({ username: bot.username });
                }}
              >
                <span className={styles.icon}>
                  <AtSignIcon />
                </span>
                <span className={styles.copy}>
                  {bot.name}
                  <small>@{bot.username}</small>
                </span>
                <ChevronRightIcon className={styles.trailing} />
              </button>
            ))}
        </div>
      </section>
      {!!conversations.data?.length && (
        <section className={styles.group}>
          <h2 className={styles.label}>{t("Conversas na rede")}</h2>
          <div className={styles.list}>
            {conversations.data.map((c) => (
              <button
                key={c.id}
                type="button"
                className={styles.row}
                onClick={() => {
                  setSelected(c.id);
                }}
              >
                <AtSignIcon />
                <span className={styles.copy}>
                  {c.name}
                  <small>@{c.username}</small>
                </span>
                <ChevronRightIcon className={styles.trailing} />
              </button>
            ))}
          </div>
        </section>
      )}
      {open.isPending && <output>{t("Abrindo conversa…")}</output>}
      {error && (
        <p role="alert">
          {t("Não foi possível atualizar sua rede. Tente novamente.")}
        </p>
      )}
      <PanelLink className={styles.row} href="/space/bot">
        <AtSignIcon />
        {t("Seu bot")}
        <ChevronRightIcon className={styles.trailing} />
      </PanelLink>
    </div>
  );
}
