"use client";

import { useRef, useState } from "react";
import { ArrowLeftIcon, CheckIcon, HistoryIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Textarea } from "@web/components/ui/textarea";
import styles from "../../space.module.css";

const starter = JSON.stringify(
  {
    name: "Minha ferramenta",
    description: "Organiza um texto.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    implementation: {
      kind: "code",
      code: "return { text: input.text.trim() };",
      requires: [],
    },
    tests: [
      { input: { text: " Hello " }, expected: { text: "Hello" }, fixtures: {} },
    ],
  },
  null,
  2
);

export function ToolEditor({
  path,
  content: initial,
  revision: initialRevision,
  mayManage,
  onClose,
  onSaved,
}: {
  readonly path: string;
  readonly content?: string;
  readonly revision: string | null;
  readonly mayManage: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [slug, setSlug] = useState(
    path === "new"
      ? ""
      : (path
          .split("/")
          .at(-1)
          ?.replace(/\.json$/u, "") ?? "")
  );
  const [content, setContent] = useState(
    initial ??
      starter
        .replace("Minha ferramenta", t("Minha ferramenta"))
        .replace("Organiza um texto.", t("Organiza um texto."))
  );
  const [saved, setSaved] = useState(
    path.startsWith("proposals/") ? initial : undefined
  );
  const [revision, setRevision] = useState(initialRevision);
  const [validated, setValidated] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const ids = useRef(new Map<string, string>());
  const write = api.workspaces.write.useMutation();
  const validate = api.workspaces.tools.validate.useMutation();
  const publish = api.workspaces.tools.publish.useMutation();
  const disable = api.workspaces.tools.disable.useMutation();
  const rollback = api.workspaces.tools.rollback.useMutation();
  const history = api.workspaces.history.useQuery(
    { path: `tools/${slug}.json` },
    { enabled: historyOpen && !!slug }
  );
  const pending =
    write.isPending ||
    validate.isPending ||
    publish.isPending ||
    disable.isPending ||
    rollback.isPending;
  const error =
    write.error ??
    validate.error ??
    publish.error ??
    disable.error ??
    rollback.error;
  const operation = (action: string) => {
    const key = `${action}:${slug}:${revision ?? "empty"}:${content}`;
    const id = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, id);
    return { slug, expectedRevision: revision, operationId: id };
  };
  const finish = async () => {
    await onSaved();
    onClose();
  };
  return (
    <section className="grid gap-5">
      <div className={styles.editorBar}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Voltar")}
          onClick={() => {
            if (
              content === (saved ?? initial ?? starter) ||
              window.confirm(t("Descartar alterações não salvas?"))
            )
              onClose();
          }}
        >
          <ArrowLeftIcon />
        </Button>
        <h2 className="type-title flex-1">{t("Ferramenta")}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Histórico")}
          disabled={!slug}
          onClick={() => {
            setHistoryOpen(!historyOpen);
          }}
        >
          <HistoryIcon />
        </Button>
      </div>
      <Input
        aria-label={t("Identificador da ferramenta")}
        placeholder={t("Identificador da ferramenta")}
        value={slug}
        disabled={path !== "new" || saved !== undefined}
        maxLength={40}
        onChange={(event) => {
          setSlug(event.target.value.toLowerCase());
        }}
      />
      <details open={path === "new"}>
        <summary className="type-body cursor-pointer py-3">
          {t("Definição e testes")}
        </summary>
        <Textarea
          className={styles.document}
          aria-label={t("Definição e testes")}
          value={content}
          spellCheck={false}
          maxLength={32768}
          onChange={(event) => {
            setContent(event.target.value);
          }}
        />
      </details>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            void validate
              .mutateAsync({ content })
              .then(() => {
                setValidated(content);
                return undefined;
              })
              .catch(() => undefined);
          }}
        >
          {validated === content && <CheckIcon />}
          {t("Testar")}
        </Button>
        <Button
          disabled={
            pending ||
            !/^[a-z][a-z0-9-]{0,39}$/u.test(slug) ||
            saved === content
          }
          onClick={() => {
            void write
              .mutateAsync({
                ...operation("save"),
                path: `proposals/tools/${slug}.json`,
                content,
              })
              .then(async (result) => {
                setRevision(result.revision);
                setSaved(content);
                await onSaved();
                return undefined;
              })
              .catch(() => undefined);
          }}
        >
          {t("Salvar proposta")}
        </Button>
        {mayManage && (
          <Button
            disabled={pending || saved !== content || validated !== content}
            onClick={() => {
              void publish
                .mutateAsync(operation("publish"))
                .then(finish)
                .catch(() => undefined);
            }}
          >
            {t("Publicar")}
          </Button>
        )}
      </div>
      {validated === content && (
        <output className="type-caption text-muted-foreground">
          {validate.data?.status === "validated"
            ? t(
                "Conexão e definição verificadas. Teste a ação no serviço antes de publicar."
              )
            : t(
                "Testes isolados passaram. O uso real mantém as permissões do espaço."
              )}
        </output>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {t(
            "Não foi possível concluir. Confira a definição e atualize a revisão antes de tentar novamente."
          )}
        </p>
      )}
      {historyOpen && (
        <div className={styles.history}>
          {history.data?.map((entry) => (
            <div
              key={entry.revision}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="type-caption">
                {new Date(entry.createdAt).toLocaleString(locale)}
              </span>
              {mayManage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    void rollback
                      .mutateAsync({
                        ...operation(`restore:${entry.revision}`),
                        revision: entry.revision,
                      })
                      .then(finish)
                      .catch(() => undefined);
                  }}
                >
                  {t("Restaurar versão")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {mayManage && path.startsWith("tools/") && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            void disable
              .mutateAsync(operation("disable"))
              .then(finish)
              .catch(() => undefined);
          }}
        >
          {t("Desativar ferramenta")}
        </Button>
      )}
    </section>
  );
}
