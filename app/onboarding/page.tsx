import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Effect } from "effect";
import { getAuthSession } from "@db/services/auth/session";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { OnboardingShell } from "@web/auth/onboarding/shell";
import { OnboardingSetup } from "@web/auth/onboarding/setup";
import { getI18n } from "@web/i18n/server";
import { serverRuntime } from "../../server/runtime";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { listUserWorkspaces } from "../../server/workspaces/directory";
import { readLinkedChannelIdentities } from "../../server/accounts/controls";
import { conversationDestinations } from "../../server/channels/destination";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("Seu Zoen"), robots: { index: false } };
}

export default async function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  const requestHeaders = await headers();
  if (!(await getAuthSession(requestHeaders)))
    redirect("/sign-in?callbackUrl=%2Fonboarding");
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(
    Array.isArray(params.callbackUrl)
      ? params.callbackUrl[0]
      : params.callbackUrl
  );
  const setup = await serverRuntime.runPromise(
    Effect.gen(function* () {
      const actor = yield* resolveWorkspaceActor(requestHeaders);
      const workspaces = yield* listUserWorkspaces(actor);
      const identities = yield* readLinkedChannelIdentities(requestHeaders);
      const destinations = yield* conversationDestinations;
      return { workspaces, identities, destinations };
    })
  );
  return (
    <OnboardingShell>
      <OnboardingSetup
        workspaces={setup.workspaces}
        identities={setup.identities}
        callbackUrl={callbackUrl}
        available={[
          ...(setup.destinations.telegram ? ["telegram" as const] : []),
          ...(setup.destinations.whatsapp ? ["kapso" as const] : []),
        ]}
      />
    </OnboardingShell>
  );
}
