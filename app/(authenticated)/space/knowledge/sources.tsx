"use client";

import { useState } from "react";
import type { OntologySchema } from "@shared/workspaces/ontology";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import styles from "../space.module.css";

type Graph = typeof OntologySchema.Type;

export function OntologySources({
  entity,
  graph,
  mayManage,
  pending,
  onSave,
}: {
  entity: Graph["entities"][number];
  graph: Graph;
  mayManage: boolean;
  pending: boolean;
  onSave: (graph: Graph) => Promise<void>;
}) {
  const { t } = useI18n();
  const files = api.workspaces.files.useQuery({}, { enabled: mayManage });
  const [path, setPath] = useState("");
  const [selected, setSelected] =
    useState<Graph["entities"][number]["sources"][number]>();
  const source = api.workspaces.files.useQuery(selected ?? {}, {
    enabled: !!selected,
  });
  const available =
    files.data?.files.filter((file) => file.startsWith("knowledge/")) ?? [];
  return (
    <details>
      <summary className={styles.row}>{t("Fontes")}</summary>
      {entity.sources.map((item) => (
        <Button
          key={`${item.path}:${item.revision}`}
          variant="ghost"
          onClick={() => {
            setSelected(item);
          }}
        >
          {item.path.replace(/^knowledge\//, "")} · {item.revision.slice(0, 8)}
        </Button>
      ))}
      {selected && source.isPending && <output>{t("Carregando…")}</output>}
      {selected && source.error && (
        <p role="alert">{t("Não foi possível abrir esta fonte.")}</p>
      )}
      {selected && source.data?.content && (
        <pre className="type-body-sm wrap-break-word whitespace-pre-wrap">
          {source.data.content}
        </pre>
      )}
      {mayManage && !!available.length && (
        <form
          className={styles.create}
          onSubmit={(event) => {
            event.preventDefault();
            const revision = files.data?.revision;
            if (!revision || !path) return;
            if (
              entity.sources.some(
                (item) => item.path === path && item.revision === revision
              )
            )
              return;
            void onSave({
              ...graph,
              entities: graph.entities.map((item) =>
                item.id === entity.id
                  ? { ...item, sources: [...item.sources, { path, revision }] }
                  : item
              ),
            }).catch(() => undefined);
          }}
        >
          <select
            className={styles.row}
            aria-label={t("Arquivo de origem")}
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
            }}
            required
          >
            <option value="">{t("Arquivo de origem")}</option>
            {available.map((file) => (
              <option key={file} value={file}>
                {file.replace(/^knowledge\//, "")}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={pending || !path}>
            {t("Vincular fonte")}
          </Button>
        </form>
      )}
    </details>
  );
}
