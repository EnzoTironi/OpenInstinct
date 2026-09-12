import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSession } from "@db/services/auth/session";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { GetStartedPanel } from "./_components/get-started-panel";

export const metadata: Metadata = {
  title: "Get started | Companion",
  description:
    "Connect Telegram or WhatsApp and start using Companion in one flow.",
};

const defaultCallback = "/?welcome=1";

export default async function GetStartedPage({
  searchParams,
}: PageProps<"/get-started">) {
  if (await getAuthSession(await headers())) redirect("/");
  const params = await searchParams;
  const callbackValue = params.callbackUrl;
  const requested = Array.isArray(callbackValue)
    ? callbackValue[0]
    : callbackValue;
  const callbackUrl =
    requested === undefined ? defaultCallback : safeCallbackUrl(requested);
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <GetStartedPanel callbackUrl={callbackUrl} />
    </main>
  );
}
