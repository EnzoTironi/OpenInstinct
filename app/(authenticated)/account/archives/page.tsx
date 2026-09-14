import { Result, Schema } from "effect";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { DownloadIcon, ArchiveIcon } from "lucide-react";
import { getI18n } from "@web/i18n/server";
import { serverRuntime } from "../../../../server/runtime";
import {
  readAccountArchive,
  readAccountArchives,
} from "../../../../server/accounts/archives";
import { PanelLink } from "../../_components/panel-link";
import styles from "../../_components/panel.module.css";

const archiveQuery = Schema.Struct({
  id: Schema.optional(Schema.String),
  after: Schema.optional(Schema.String),
  filesAfter: Schema.optional(Schema.String),
});

export default async function AccountArchivesPage({
  searchParams,
}: PageProps<"/account/archives">) {
  const { t, locale } = await getI18n();
  const params = Result.getOrElse(
    Schema.decodeUnknownResult(archiveQuery)(await searchParams),
    notFound
  );
  const requestHeaders = await headers();
  const archives = await serverRuntime.runPromise(
    readAccountArchives(requestHeaders)
  );
  const selected = archives.find((archive) => archive.id === params.id);
  const archive = selected
    ? await serverRuntime.runPromise(
        readAccountArchive(
          requestHeaders,
          selected.id,
          params.after,
          params.filesAfter
        )
      )
    : undefined;
  return (
    <div className={styles.page}>
      <h1 className="type-page-title">{t("Contas anteriores")}</h1>
      <p>
        {t(
          "Seu histórico foi preservado. As novas conversas usam sua conta atual."
        )}
      </p>
      {!archives.length && <p>{t("Nenhuma conta arquivada.")}</p>}
      {!archive ? (
        <nav className={styles.actionList}>
          {archives.map((item) => (
            <PanelLink href={`/account/archives?id=${item.id}`} key={item.id}>
              <ArchiveIcon aria-hidden="true" />
              <span>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                }).format(new Date(item.createdAt))}
              </span>
            </PanelLink>
          ))}
        </nav>
      ) : (
        <>
          <nav className={styles.actionList}>
            <a href={`/api/account/archives/${archive.id}?section=memory`}>
              <DownloadIcon aria-hidden="true" />
              <span>{t("Baixar memórias anteriores")}</span>
            </a>
            {archive.hasRepository && (
              <a href={`/api/account/archives/${archive.id}?section=files`}>
                <DownloadIcon aria-hidden="true" />
                <span>{t("Baixar arquivos e versões")}</span>
              </a>
            )}
            {archive.attachments.map((file) => (
              <a
                key={file.id}
                href={`/api/account/archives/${archive.id}?section=${file.kind}&attachment=${file.id}`}
              >
                <DownloadIcon aria-hidden="true" />
                <span>{file.filename}</span>
              </a>
            ))}
          </nav>
          {archive.nextFile && (
            <PanelLink
              href={`/account/archives?id=${archive.id}&filesAfter=${archive.nextFile}`}
            >
              {t("Mais arquivos")}
            </PanelLink>
          )}
          <h2 className="type-section-title">{t("Conversas anteriores")}</h2>
          {archive.messages.map((message) => (
            <article key={message.cursor} className={styles.sectionCard}>
              <small>
                {message.direction === "inbound" ? t("Você") : "Zoen"}
              </small>
              <p className="wrap-break-word whitespace-pre-wrap">
                {message.text || t("Anexo")}
              </p>
            </article>
          ))}
          {archive.next && (
            <PanelLink
              href={`/account/archives?id=${archive.id}&after=${archive.next}`}
            >
              {t("Mais mensagens")}
            </PanelLink>
          )}
        </>
      )}
    </div>
  );
}
