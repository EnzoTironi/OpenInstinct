import { Effect, Result } from "effect";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSession } from "@db/services/auth/session";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { serverRuntime } from "../../../server/runtime";
import { readLinkedChannelIdentities } from "../../../server/accounts/controls";
import { LinkedChannels } from "./linked-channels";
import { PersonalMemorySection } from "./personal-memory";
import { AccountBillingSection } from "./_components/billing-section";
import { readEntitlement } from "@db/services/billing";

export default async function AccountPage() {
  const requestHeaders = await headers();
  const session = await getAuthSession(requestHeaders);
  if (!session) redirect("/sign-in?callbackUrl=%2Faccount");
  const result = await serverRuntime.runPromise(
    readLinkedChannelIdentities(requestHeaders).pipe(Effect.result)
  );
  if (Result.isFailure(result) && result.failure.reason === "unauthenticated")
    redirect("/sign-in?callbackUrl=%2Faccount");
  const entitlement = await readEntitlement("user", session.user.id);
  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-8 px-4 py-6 sm:p-8">
      <header className="space-y-2">
        <h1 className="type-page-title">Your account</h1>
        <p className="type-supporting-body text-muted-foreground">
          Signed in as {session.user.name || "your Companion account"}.
        </p>
      </header>
      {Result.isFailure(result) ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load linked channels</AlertTitle>
          <AlertDescription>Reload this page to try again.</AlertDescription>
        </Alert>
      ) : (
        <>
          <section
            aria-labelledby="linked-channels-heading"
            className="space-y-4"
          >
            <div className="space-y-2">
              <h2 id="linked-channels-heading" className="type-section-title">
                Linked channels
              </h2>
              <p className="type-supporting-body text-muted-foreground">
                These messenger accounts can reach your assistant and sign in to
                this Companion account.
              </p>
            </div>
            <LinkedChannels identities={result.success} />
          </section>
          <section
            aria-labelledby="link-channel-heading"
            className="space-y-4 rounded-xl border p-4 sm:p-6"
          >
            <div className="space-y-2">
              <h2 id="link-channel-heading" className="type-section-title">
                Link another channel
              </h2>
              <p className="type-supporting-body text-muted-foreground">
                Link a messenger account to{" "}
                {session.user.name || "your current Companion account"}. Confirm
                the request from the messenger account you want to add.
              </p>
            </div>
            <ChannelAuthForm purpose="link" callbackUrl="/account" />
          </section>
        </>
      )}
      <AccountBillingSection
        plan={entitlement.plan}
        seatCount={entitlement.seatCount}
        status={entitlement.status}
      />
      <PersonalMemorySection />
    </main>
  );
}
