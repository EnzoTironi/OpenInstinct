"use client";
import { useMemo, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { cn } from "@web/components/class-names";
import { DiagnosticReplay } from "./replay";
import styles from "../_components/panel.module.css";

export function DiagnosticSession({
  sessionId,
  platform,
  onClose,
}: {
  readonly sessionId: string;
  readonly platform: boolean;
  readonly onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const utils = api.useUtils();
  const review = api.insights.review.useMutation();
  const [failed, setFailed] = useState(false);
  const detail = api.insights.session.useInfiniteQuery(
    { sessionId, platform },
    {
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      initialCursor: null,
    }
  );
  const pages = detail.data?.pages;
  const events = useMemo(
    () => pages?.flatMap((page) => page.events) ?? [],
    [pages]
  );
  const exportSession = () => {
    if (!detail.data) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              source: "zoen-diagnostic",
              session: sessionId,
              complete: !detail.hasNextPage,
              events,
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      )
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `zoen-diagnostic-${sessionId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className={cn(styles.sectionCard, "mt-6")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="type-section-title">{t("Diagnóstico")}</h2>
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
          }}
        >
          {t("Fechar")}
        </Button>
      </div>
      {detail.isLoading && <output>{t("Carregando…")}</output>}
      {detail.data && (
        <>
          <div className="my-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportSession}>
              <DownloadIcon size={16} />{" "}
              {t(
                detail.hasNextPage
                  ? "Exportar registros carregados"
                  : "Exportar"
              )}
            </Button>
            {platform &&
              (["investigating", "resolved", "eval-candidate"] as const).map(
                (status, i) => (
                  <Button
                    key={status}
                    variant="ghost"
                    disabled={review.isPending}
                    onClick={() => {
                      void review
                        .mutateAsync({ sessionId, status })
                        .then(() => utils.insights.read.invalidate())
                        .catch(() => {
                          setFailed(true);
                        });
                    }}
                  >
                    {t(
                      ["Investigar", "Resolvido", "Candidato a eval"][i] ??
                        "Investigar"
                    )}
                  </Button>
                )
              )}
          </div>
          {detail.hasNextPage && (
            <Button
              variant="ghost"
              disabled={detail.isFetchingNextPage}
              onClick={() => void detail.fetchNextPage()}
            >
              {t("Carregar mais")}
            </Button>
          )}
          <DiagnosticReplay events={events} />
          <div className="mt-4 flex flex-col gap-2">
            {events
              .filter((event) => event.kind !== "replay")
              .map((event) => (
                <details key={event.id}>
                  <summary className="cursor-pointer type-caption">
                    {new Date(event.created_at).toLocaleTimeString(locale)} ·{" "}
                    {event.kind}
                    {event.status === "failed" ? " · ⚠" : ""}
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-background/40 p-3 type-caption break-all whitespace-pre-wrap">
                    {event.payload ?? event.metadata}
                  </pre>
                </details>
              ))}
          </div>
        </>
      )}
      {(failed || detail.error) && (
        <p role="alert" className="my-4 type-caption">
          {t("Não foi possível carregar os diagnósticos.")}
        </p>
      )}
    </section>
  );
}
