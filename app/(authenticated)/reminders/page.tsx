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
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-6 sm:p-8">
      <header className="space-y-3">
        <h1 className="type-page-title">Reminders</h1>
        <p className="type-supporting-body text-muted-foreground">
          Scheduled requests across your conversations. To change or cancel one,
          return to its original conversation.
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/chat" />}
          variant="outline"
        >
          Open conversation
        </Button>
      </header>
      {Result.isFailure(result) ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load reminders</AlertTitle>
          <AlertDescription>
            Please reload this page to try again. Your schedules have not been
            changed.
          </AlertDescription>
        </Alert>
      ) : (
        <ReminderList {...result.success} />
      )}
    </div>
  );
}
