import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Effect } from "effect";
import { conversationDestinations } from "../../server/channels/destination";
import { GetStartedPanel } from "./_components/get-started-panel";

export const metadata: Metadata = {
  title: "Começar uma conversa | Zoen",
  description: "Abra seu mensageiro e faça o primeiro pedido ao Zoen.",
  robots: { index: false },
};

export default async function GetStartedPage({
  searchParams,
}: PageProps<"/get-started">) {
  const params = await searchParams;
  const destinations = await Effect.runPromise(conversationDestinations);
  const destination =
    params.channel === "imessage"
      ? destinations.imessage
      : params.channel === "telegram"
        ? destinations.telegram
        : params.channel === "whatsapp" || params.channel === undefined
          ? (destinations.whatsapp ??
            destinations.telegram ??
            destinations.imessage)
          : null;
  if (destination) redirect(destination);
  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background px-5 py-12 text-foreground"
      lang="pt-BR"
    >
      <GetStartedPanel
        whatsappUrl={destinations.whatsapp}
        telegramUrl={destinations.telegram}
        imessageUrl={destinations.imessage}
      />
    </main>
  );
}
