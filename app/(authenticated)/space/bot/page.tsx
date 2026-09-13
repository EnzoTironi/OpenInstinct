"use client";

import { Schema } from "effect";

import { useState } from "react";
import { AtSignIcon, KeyRoundIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function WorkspaceBotPage() {
  const { t } = useI18n();
  const state = api.workspaces.bot.read.useQuery();
  const save = api.workspaces.bot.save.useMutation();
  const issue = api.workspaces.bot.grant.useMutation();
  const revoke = api.workspaces.bot.revoke.useMutation();
  const [query, setQuery] = useState("");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const search = api.workspaces.bot.search.useQuery(
    { query },
    { enabled: /^[a-z][a-z0-9_]{1,29}$/.test(query) }
  );
  const refresh = () => state.refetch();
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-memory.png"
        title={t("Um Zoen com seu jeito.")}
      />
      {state.isPending ? (
        <output>{t("Carregando…")}</output>
      ) : (
        <form
          className={styles.create}
          key={state.data?.bot?.username ?? "new"}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void save
              .mutateAsync({
                username: Schema.decodeUnknownSync(Schema.String)(
                  values.get("username")
                )
                  .trim()
                  .toLowerCase(),
                name: Schema.decodeUnknownSync(Schema.String)(
                  values.get("name")
                ).trim(),
                description: Schema.decodeUnknownSync(Schema.String)(
                  values.get("description")
                ),
                discoverable: values.get("discoverable") === "on",
              })
              .then(refresh)
              .catch(() => undefined);
          }}
        >
          <Input
            name="name"
            aria-label={t("Nome do bot")}
            placeholder={t("Nome do bot")}
            defaultValue={state.data?.bot?.name ?? "Zoen"}
            maxLength={60}
            required
            disabled={!state.data?.mayManage}
          />
          <div className={styles.row}>
            <AtSignIcon />
            <Input
              name="username"
              aria-label={t("Username do bot")}
              placeholder={t("Username do bot")}
              defaultValue={state.data?.bot?.username}
              pattern="[a-z][a-z0-9_]{2,29}"
              minLength={3}
              maxLength={30}
              required
              disabled={!state.data?.mayManage}
            />
          </div>
          <Input
            name="description"
            aria-label={t("Como ele pode ajudar?")}
            placeholder={t("Como ele pode ajudar?")}
            defaultValue={state.data?.bot?.description}
            maxLength={240}
            disabled={!state.data?.mayManage}
          />
          <label className={styles.row}>
            <input
              type="checkbox"
              name="discoverable"
              defaultChecked={state.data?.bot?.discoverable}
              disabled={!state.data?.mayManage}
            />
            <span>{t("Aparecer na busca")}</span>
          </label>
          {state.data?.mayManage && (
            <Button type="submit" disabled={save.isPending}>
              {t("Salvar")}
            </Button>
          )}
        </form>
      )}
      {(state.error ?? save.error ?? issue.error ?? revoke.error) && (
        <p role="alert" className={styles.error}>
          {t("Não foi possível concluir. Confira o @ e tente novamente.")}
        </p>
      )}
      {state.data?.bot && state.data.mayManage && (
        <details>
          <summary className={styles.row}>
            <KeyRoundIcon />
            {t("Acesso para outros agentes")}
          </summary>
          <p className={styles.empty}>
            {t(
              "Compartilhe os arquivos deste espaço. Memórias privadas e conexões ficam protegidas."
            )}
          </p>
          <form
            className={styles.create}
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              void issue
                .mutateAsync({
                  label: Schema.decodeUnknownSync(Schema.String)(
                    values.get("label")
                  ).trim(),
                  capabilities: ["files", "ontology"],
                  days: 30,
                })
                .then((grant) => {
                  setToken(grant.token);
                  setCopied(false);
                  return refresh();
                })
                .catch(() => undefined);
            }}
          >
            <Input
              name="label"
              aria-label={t("Nome do acesso")}
              placeholder={t("Nome do acesso")}
              required
              maxLength={80}
            />
            <Button type="submit" disabled={issue.isPending}>
              {t("Criar acesso por 30 dias")}
            </Button>
          </form>
          {token && (
            <div className={styles.create}>
              <Input value={token} readOnly aria-label={t("Chave de acesso")} />
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(token).then(() => {
                    setCopied(true);
                    return undefined;
                  });
                }}
              >
                {t(copied ? "Copiado" : "Copiar")}
              </Button>
              <p>{t("Guarde esta chave. Ela aparece apenas agora.")}</p>
            </div>
          )}
          <div className={styles.list}>
            {state.data.grants.map((grant) => (
              <div className={styles.row} key={grant.id}>
                <KeyRoundIcon />
                <span>
                  {grant.label}
                  <small>
                    {t(grant.revokedAt ? "Revogado" : "Expira em")}{" "}
                    {!grant.revokedAt &&
                      new Date(grant.expiresAt).toLocaleDateString()}
                  </small>
                </span>
                {!grant.revokedAt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={revoke.isPending}
                    aria-label={t("Revogar acesso")}
                    onClick={() => {
                      void revoke
                        .mutateAsync({ id: grant.id })
                        .then(refresh)
                        .catch(() => undefined);
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className={styles.empty}>
            A2A: <code>/agents/{state.data.bot.username}</code>
          </p>
        </details>
      )}
      <div className={styles.create}>
        <div className={styles.row}>
          <SearchIcon />
          <Input
            aria-label={t("Encontrar um bot")}
            placeholder={t("Encontrar um bot")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value.toLowerCase().replace(/^@/, ""));
            }}
            maxLength={30}
          />
        </div>
        <div className={styles.list}>
          {query.length >= 2 &&
            search.data?.map((bot) => (
              <div className={styles.row} key={bot.username}>
                <AtSignIcon />
                <span>
                  {bot.name}
                  <small>
                    @{bot.username} · {bot.description}
                  </small>
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
