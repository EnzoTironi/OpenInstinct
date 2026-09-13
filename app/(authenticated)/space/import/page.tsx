"use client";

import { z } from "zod";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileUpIcon, LoaderCircleIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import {
  browserWorkspaceHeaders,
  workspaceHref,
} from "@web/workspaces/navigation";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function ImportDocumentPage() {
  const { t } = useI18n();
  const router = useRouter();
  const space = useSearchParams().get("space");
  const listing = api.workspaces.files.useQuery({});
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const operation = useRef<string | undefined>(undefined);
  const upload = async () => {
    if (!file || !listing.data) return;
    setBusy(true);
    setError(undefined);
    const body = new FormData();
    body.set("file", file);
    body.set("operationId", (operation.current ??= crypto.randomUUID()));
    if (listing.data.revision) body.set("revision", listing.data.revision);
    try {
      const response = await fetch("/api/workspaces/import", {
        method: "POST",
        headers: browserWorkspaceHeaders(),
        body,
      });
      if (!response.ok) {
        const result = z
          .object({ error: z.string() })
          .safeParse(await response.json());
        const code = result.success ? result.data.error : null;
        setError(
          code === "needs_ocr"
            ? t(
                "Este PDF precisa de OCR. Envie uma versão com texto selecionável."
              )
            : code === "conflict"
              ? t("Seu espaço mudou. Volte e tente importar novamente.")
              : t("Não foi possível importar este arquivo.")
        );
        return;
      }
      await listing.refetch();
      router.replace(workspaceHref("/space", space), { scroll: false });
    } catch {
      setError(t("Não foi possível importar este arquivo."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-briefing.png"
        title={t("Traga o que você já sabe.")}
        description={t("PDF, Word, planilhas e apresentações.")}
      />
      <label className={styles.upload}>
        <FileUpIcon aria-hidden="true" />
        <span>{file?.name ?? t("Escolher arquivo")}</span>
        <small>{t("Até 10 MB. Conversão local, sem OCR externo.")}</small>
        <input
          type="file"
          disabled={busy}
          accept=".md,.txt,.csv,.pdf,.doc,.docx,.odt,.rtf,.epub,.ppt,.pptx,.xlsx,.xls,.ods,.odp"
          onChange={(event) => {
            setFile(event.target.files?.[0]);
            operation.current = undefined;
            setError(undefined);
          }}
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          disabled={!file || file.size > 10485760 || busy || !listing.data}
          onClick={() => {
            void upload();
          }}
        >
          {busy && <LoaderCircleIcon className="animate-spin" />}
          {busy ? t("Importando…") : t("Adicionar ao espaço")}
        </Button>
      </div>
    </div>
  );
}
