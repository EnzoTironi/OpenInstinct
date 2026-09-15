"use client";

import { useRef, useState } from "react";
import { Schema } from "effect";
import { ChevronRightIcon, PlugIcon, PlusIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Textarea } from "@web/components/ui/textarea";
import { ConnectorForm } from "./connector-form";
import styles from "../../space.module.css";

export function ConnectorLibrary({
  mayManage,
  onProposed,
}: {
  readonly mayManage: boolean;
  readonly onProposed: (path: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const connections = api.workspaces.tools.connections.list.useQuery();
  const workspace = api.workspaces.tools.list.useQuery();
  const propose = api.workspaces.tools.connections.propose.useMutation();
  const revoke = api.workspaces.tools.connections.revoke.useMutation();
  const test = api.workspaces.tools.connections.test.useMutation();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<{
    connectionId: string;
    operation: string;
  }>();
  const [slug, setSlug] = useState("");
  const [input, setInput] = useState("{}");
  const [invalidInput, setInvalidInput] = useState(false);
  const ids = useRef(new Map<string, string>());
  const operationId = (key: string) => {
    const id = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, id);
    return id;
  };
  const connection = connections.data?.find(
    (entry) => entry.id === selected?.connectionId
  );
  const operation = connection?.operations.find(
    (entry) => entry.id === selected?.operation
  );
  const pending = propose.isPending || revoke.isPending || test.isPending;
  if (adding)
    return (
      <ConnectorForm
        onClose={() => {
          setAdding(false);
        }}
        onConnected={async () => {
          await connections.refetch();
          setAdding(false);
        }}
      />
    );
  if (connection && operation) {
    const selection = {
      connectionId: connection.id,
      revision: connection.revision,
      operation: operation.id,
    };
    return (
      <div className="grid gap-4">
        <h3 className="type-title">{operation.name}</h3>
        <p className="type-caption text-muted-foreground">
          {connection.name} · {new URL(connection.endpoint).hostname}
        </p>
        <p className="type-body">{operation.description}</p>
        <details>
          <summary className="py-2 type-caption">
            {t("Formato dos argumentos")}
          </summary>
          <pre className="overflow-x-auto type-caption">
            {JSON.stringify(operation.inputSchema, null, 2)}
          </pre>
        </details>
        <Textarea
          aria-label={t("Argumentos em JSON")}
          value={input}
          maxLength={65536}
          onChange={(e) => {
            setInput(e.target.value);
            test.reset();
            setInvalidInput(false);
          }}
        />
        <p className="type-caption text-muted-foreground">
          {t("Este teste executa a ação real no serviço conectado.")}
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            try {
              const parsed = Schema.decodeUnknownSync(
                Schema.fromJsonString(
                  Schema.Record(Schema.String, Schema.Unknown)
                )
              )(input);
              void test
                .mutateAsync({
                  ...selection,
                  input: parsed,
                  operationId: operationId(
                    `test:${connection.id}:${operation.id}:${input}`
                  ),
                })
                .catch(() => undefined);
            } catch {
              setInvalidInput(true);
            }
          }}
        >
          {t("Autorizar e testar")}
        </Button>
        {test.data && (
          <output
            className="max-h-40 overflow-auto type-caption whitespace-pre-wrap"
            data-private
          >
            {JSON.stringify(test.data, null, 2)}
          </output>
        )}
        {(invalidInput || test.error) && (
          <p role="alert">
            {t(
              "Resultado não confirmado. Confira os argumentos e o serviço antes de iniciar outra ação."
            )}
          </p>
        )}
        <Input
          aria-label={t("Identificador da ferramenta")}
          placeholder={t("Identificador da ferramenta")}
          value={slug}
          maxLength={40}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase());
          }}
        />
        <Button
          disabled={pending || !/^[a-z][a-z0-9-]{0,39}$/u.test(slug)}
          onClick={() => {
            void propose
              .mutateAsync({
                ...selection,
                slug,
                expectedRevision: workspace.data?.revision ?? null,
                operationId: operationId(
                  `propose:${connection.id}:${operation.id}:${slug}:${workspace.data?.revision ?? ""}`
                ),
              })
              .then(async () => {
                await onProposed(`proposals/tools/${slug}.json`);
                return undefined;
              })
              .catch(() => undefined);
          }}
        >
          {t("Salvar proposta")}
        </Button>
        {propose.error && (
          <p role="alert">
            {t("Não foi possível salvar. Atualize o espaço e tente novamente.")}
          </p>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setSelected(undefined);
          }}
        >
          {t("Voltar")}
        </Button>
      </div>
    );
  }
  return (
    <section className="grid gap-4" aria-label={t("Serviços conectados")}>
      <h3 className="type-title">{t("Serviços conectados")}</h3>
      {connections.data?.map((entry) => (
        <details
          key={entry.id}
          className="rounded-2xl border border-border px-4"
        >
          <summary className="type-body flex cursor-pointer items-center gap-3 py-3">
            <PlugIcon aria-hidden="true" />
            {entry.name}
            <ChevronRightIcon className="ml-auto" aria-hidden="true" />
          </summary>
          <div className={styles.list}>
            {entry.operations.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={styles.row}
                onClick={() => {
                  setSelected({ connectionId: entry.id, operation: tool.id });
                  setInput("{}");
                  setSlug(
                    tool.id
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/gu, "-")
                      .slice(0, 40)
                  );
                  test.reset();
                }}
              >
                <span className="min-w-0 flex-1">{tool.name}</span>
                <PlusIcon aria-hidden="true" />
              </button>
            ))}
          </div>
          {mayManage && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      "Desconectar este serviço e desativar as ferramentas que dependem dele?"
                    )
                  )
                )
                  void revoke
                    .mutateAsync({ id: entry.id })
                    .then(async () => {
                      await connections.refetch();
                      return undefined;
                    })
                    .catch(() => undefined);
              }}
            >
              {t("Desconectar")}
            </Button>
          )}
        </details>
      ))}
      {(connections.error ?? revoke.error) && (
        <p role="alert">{t("Não foi possível atualizar as conexões.")}</p>
      )}
      {mayManage && (
        <Button
          variant="outline"
          onClick={() => {
            setAdding(true);
          }}
        >
          <PlusIcon />
          {t("Conectar serviço")}
        </Button>
      )}
    </section>
  );
}
