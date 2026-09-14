import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Effect } from "effect";
import { OnboardingShell } from "@web/auth/onboarding/shell";
import { conversationDestinations } from "../../server/channels/destination";
import { GetStartedPanel } from "./_components/get-started-panel";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Começar uma conversa | Zoen"),
    description: t("Abra seu mensageiro e faça o primeiro pedido ao Zoen."),
    robots: { index: false },
  };
}

export default async function GetStartedPage({
  searchParams,
}: PageProps<"/get-started">) {
  const params = await searchParams;
  if (params.channel === undefined)
    redirect("/sign-in?callbackUrl=%2Fonboarding");
  const destinations = await Effect.runPromise(conversationDestinations);
  const destination =
    params.channel === "imessage"
      ? destinations.imessage
      : params.channel === "telegram"
        ? destinations.telegram
        : params.channel === "whatsapp"
          ? (destinations.whatsapp ??
            destinations.telegram ??
            destinations.imessage)
          : null;
  if (destination) redirect(destination);
  return (
    <OnboardingShell>
      <GetStartedPanel
        whatsappUrl={destinations.whatsapp}
        telegramUrl={destinations.telegram}
        imessageUrl={destinations.imessage}
      />
    </OnboardingShell>
  );
}
