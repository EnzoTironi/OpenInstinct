import { PlusIcon } from "lucide-react";
import styles from "../_components/panel.module.css";
import { Effect, Result } from "effect";
import Link from "next/link";
import { ReminderList } from "./reminder-list";
import { serverRuntime } from "../../../server/runtime";
import { listReminders } from "../../../server/schedules/queries";
import { requireRequestScope } from "@web/auth/request-scope";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";

export default async function RemindersPage() {
  const scope = await requireRequestScope();
  const result = await serverRuntime.runPromise(
    listReminders(scope).pipe(Effect.result)
  );
  return (
    <div className={styles.page}>
      {(Result.isFailure(result) || result.success.reminders.length > 0) && (
        <header className={styles.pageHeader}>
          <div>
            <h1 className="type-page-title">Já está combinado.</h1>
            <p className={styles.intro}>
              Ajuste cada pedido na conversa em que ele começou.
            </p>
          </div>
          <Button
            nativeButton={false}
            render={<Link href="/chat?starter=reminder" />}
            variant="outline"
          >
            <PlusIcon aria-hidden="true" /> Criar automação
          </Button>
        </header>
      )}
      {Result.isFailure(result) ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar as automações</AlertTitle>
          <AlertDescription>
            Atualize a página para tentar novamente. Seus agendamentos foram
            preservados.
          </AlertDescription>
        </Alert>
      ) : (
        <ReminderList {...result.success} />
      )}
    </div>
  );
}
