import type { Metadata } from "next";
import { headers } from "next/headers";
import { QueryProvider } from "@app/_providers/query-provider";
import { TooltipProvider } from "@web/components/ui/tooltip";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { applicationOrigin } from "@shared/environment/origin";
import { getAuthSession } from "@db/services/auth/session";
import { getI18n } from "@web/i18n/server";
import { I18nProvider } from "@web/i18n/provider";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    metadataBase: new URL(applicationOrigin()),
    title: "Zoen",
    description: t("Zoen — seu assistente no WhatsApp, Telegram e iMessage."),
    icons: {
      icon: [{ url: "/marketing/zoen-favicon.png", type: "image/png" }],
    },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, messages } = await getI18n();
  const session = await getAuthSession(await headers());
  const workspaceId = session
    ? accessScopeForUser(`better-auth:${session.user.id}`).workspaceId
    : undefined;

  return (
    <html lang={locale}>
      <body data-workspace-id={workspaceId}>
        <I18nProvider locale={locale} messages={messages}>
          <QueryProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </QueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
