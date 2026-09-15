"use client";

import { useState } from "react";
import { ChevronRightIcon, PlusIcon, WrenchIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { ToolEditor } from "./tool-editor";
import { ConnectorLibrary } from "./connector-library";
import styles from "../../space.module.css";

export function ToolLibrary({ mayManage }: { readonly mayManage: boolean }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string>();
  const listing = api.workspaces.tools.list.useQuery();
  const file = api.workspaces.files.useQuery(
    { path: selected },
    { enabled: !!selected && selected !== "new" }
  );
  if (selected && selected !== "new" && file.isPending)
    return <output>{t("Carregando…")}</output>;
  if (selected && !file.error)
    return (
      <ToolEditor
        key={selected}
        path={selected}
        content={
          selected === "new" ? undefined : (file.data?.content ?? undefined)
        }
        revision={listing.data?.revision ?? null}
        mayManage={mayManage}
        onClose={() => {
          setSelected(undefined);
        }}
        onSaved={async () => {
          await listing.refetch();
        }}
      />
    );
  return (
    <section className="grid gap-4" aria-label={t("Ferramentas")}>
      <p className="type-body text-muted-foreground">
        {t("Peça ao Zoen uma ferramenta. Teste e publique aqui.")}
      </p>
      <div className={styles.list}>
        {listing.data?.tools.map((tool) => (
          <button
            key={tool.path}
            type="button"
            className={styles.row}
            onClick={() => {
              setSelected(tool.path);
            }}
          >
            <WrenchIcon aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <strong className="type-body block">{tool.name}</strong>
              <small className="type-caption text-muted-foreground">
                {tool.draft ? t("Proposta") : t("Publicada")}
              </small>
            </span>
            <ChevronRightIcon aria-hidden="true" />
          </button>
        ))}
      </div>
      {(listing.error ?? file.error) && (
        <p role="alert">{t("Não foi possível abrir o arquivo.")}</p>
      )}
      <Button
        variant="outline"
        onClick={() => {
          setSelected("new");
        }}
      >
        <PlusIcon />
        {t("Nova ferramenta")}
      </Button>
      <ConnectorLibrary
        mayManage={mayManage}
        onProposed={async (path) => {
          await listing.refetch();
          setSelected(path);
        }}
      />
    </section>
  );
}
