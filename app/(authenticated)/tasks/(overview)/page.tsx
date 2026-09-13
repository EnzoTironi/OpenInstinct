import { getI18n } from "@web/i18n/server";
import { listBrowserTraces } from "@db/services/browser-traces";
import { requireRequestScope } from "@web/auth/request-scope";
import { TraceHistory } from "./_components/trace-history";
import styles from "../_components/activity.module.css";

export default async function TasksPage() {
  const { t } = await getI18n();
  const scope = await requireRequestScope();
  let initialError: string | undefined;
  let initialPage;
  try {
    initialPage = await listBrowserTraces(scope);
  } catch (error) {
    console.error(t("Unable to read browser traces"), error);
    initialError = t("Não foi possível carregar a atividade. Tente atualizar.");
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className="type-page-title">{t("Atividade")}</h1>
        <p className="type-supporting-body">
          {t("O que o Zoen fez por você no navegador.")}
        </p>
      </header>

      <TraceHistory initialError={initialError} initialPage={initialPage} />
    </div>
  );
}
