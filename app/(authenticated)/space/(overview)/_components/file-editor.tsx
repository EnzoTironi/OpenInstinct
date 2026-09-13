"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  CheckIcon,
  HistoryIcon,
  SaveIcon,
  Trash2Icon,
  DownloadIcon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Textarea } from "@web/components/ui/textarea";
import styles from "../../space.module.css";
import { workspaceHref } from "@web/workspaces/navigation";

export function FileEditor({
  path,
  content: initial,
  revision,
  onClose,
  onSaved,
  readOnly,
}: {
  readonly path: string;
  readonly content: string;
  readonly revision: string | null;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
  readonly readOnly: boolean;
}) {
  const { t, locale } = useI18n();
  const space = useSearchParams().get("space");
  const [content, setContent] = useState(initial);
  const [savedContent, setSavedContent] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [showHistory, setShowHistory] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const history = api.workspaces.history.useQuery(
    { path },
    { enabled: showHistory }
  );
  const previous = api.workspaces.files.useQuery(
    { path, revision: selectedVersion },
    { enabled: !!selectedVersion }
  );
  const write = api.workspaces.write.useMutation();
  const pendingSave = useRef<
    | { content: string; revision: string | null; operationId: string }
    | undefined
  >(undefined);
  const dirty = content !== savedContent;
  const save = async () => {
    if (
      pendingSave.current?.content !== content ||
      pendingSave.current.revision !== baseRevision
    )
      pendingSave.current = {
        content,
        revision: baseRevision,
        operationId: crypto.randomUUID(),
      };
    const result = await write.mutateAsync({
      path,
      content,
      expectedRevision: baseRevision,
      operationId: pendingSave.current.operationId,
    });
    setBaseRevision(result.revision);
    setSavedContent(content);
    setSaved(true);
    await onSaved();
  };
  return (
    <section className={styles.editor}>
      <div className={styles.editorBar}>
        <Button
          aria-label={t("Voltar")}
          variant="ghost"
          size="icon"
          onClick={() => {
            if (!dirty || window.confirm(t("Descartar alterações não salvas?")))
              onClose();
          }}
        >
          <ArrowLeftIcon />
        </Button>
        <span className={styles.filename}>{path.split("/").at(-1)}</span>
        {revision && !readOnly && (
          <Button
            aria-label={t("Remover arquivo")}
            variant="ghost"
            size="icon"
            disabled={write.isPending}
            onClick={() => {
              if (
                window.confirm(
                  t("Remover da versão atual? O arquivo continua no histórico.")
                )
              )
                void write
                  .mutateAsync({
                    path,
                    content: null,
                    expectedRevision: baseRevision,
                    operationId: crypto.randomUUID(),
                  })
                  .then(async () => {
                    await onSaved();
                    onClose();
                    return undefined;
                  })
                  .catch(() => undefined);
            }}
          >
            <Trash2Icon />
          </Button>
        )}
        <Button
          aria-label={t("Histórico")}
          variant="ghost"
          size="icon"
          onClick={() => {
            setShowHistory(!showHistory);
          }}
        >
          <HistoryIcon />
        </Button>
      </div>
      {showHistory && (
        <div className={styles.history}>
          {history.error && (
            <p role="alert">{t("Não foi possível abrir o histórico.")}</p>
          )}
          {history.isPending ? (
            <output>{t("Carregando…")}</output>
          ) : history.data?.length === 0 ? (
            <p>{t("O histórico começa quando você salva.")}</p>
          ) : (
            history.data?.map((entry) => (
              <button
                type="button"
                key={entry.revision}
                onClick={() => {
                  setSelectedVersion(entry.revision);
                }}
                className={styles.historyRow}
              >
                <HistoryIcon aria-hidden="true" />
                <span>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(entry.createdAt))}
                </span>
                <small>{entry.revision.slice(0, 7)}</small>
              </button>
            ))
          )}
          {selectedVersion &&
            previous.data?.content !== null &&
            previous.data?.content !== undefined && (
              <div className={styles.version}>
                {history.data?.some(
                  (entry) =>
                    entry.revision === selectedVersion &&
                    entry.source === "import"
                ) && (
                  <a
                    href={workspaceHref(
                      `/api/workspaces/source?revision=${encodeURIComponent(selectedVersion)}`,
                      space
                    )}
                  >
                    <DownloadIcon />
                    {t("Baixar original")}
                  </a>
                )}
                <pre>{previous.data.content}</pre>
                <Button
                  variant="secondary"
                  disabled={readOnly}
                  onClick={() => {
                    setContent(previous.data?.content ?? "");
                    setSelectedVersion(undefined);
                    setShowHistory(false);
                    setSaved(false);
                  }}
                >
                  {t("Usar esta versão")}
                </Button>
              </div>
            )}
        </div>
      )}
      <Textarea
        className={styles.document}
        aria-label={t("Conteúdo do arquivo")}
        value={content}
        maxLength={262144}
        spellCheck={false}
        readOnly={readOnly}
        onChange={(event) => {
          setContent(event.target.value);
          setSaved(false);
        }}
      />
      {write.error && (
        <p className={styles.error} role="alert">
          {write.error.data?.code === "CONFLICT"
            ? t(
                "Este arquivo mudou. Volte e abra a versão mais recente antes de salvar."
              )
            : t("Não foi possível salvar. Seu texto continua aqui.")}
        </p>
      )}
      <div className={styles.saveBar}>
        <span className={styles.caption}>
          {saved && !dirty
            ? t("Salvo no seu espaço")
            : t("Só este espaço pode acessar este arquivo.")}
        </span>
        <Button
          disabled={write.isPending || readOnly}
          onClick={() => {
            void save().catch(() => undefined);
          }}
        >
          {saved && !dirty ? <CheckIcon /> : <SaveIcon />}
          {write.isPending ? t("Salvando…") : t("Salvar")}
        </Button>
      </div>
    </section>
  );
}
