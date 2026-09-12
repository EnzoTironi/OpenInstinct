import type { Metadata } from "next";
import { headers } from "next/headers";
import { QueryProvider } from "@app/_providers/query-provider";
import { TooltipProvider } from "@web/components/ui/tooltip";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { applicationOrigin } from "@shared/environment/origin";
import { getAuthSession } from "@db/services/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(applicationOrigin()),
  title: "Companion",
  description:
    "Companion by Instinct — your assistant in Telegram, WhatsApp, and the web.",
  icons: {
    icon: [{ url: "/icon", type: "image/png" }, { url: "/favicon.ico" }],
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getAuthSession(await headers());
  const workspaceId = session
    ? accessScopeForUser(`better-auth:${session.user.id}`).workspaceId
    : undefined;

  return (
    <html lang="en">
      <body data-workspace-id={workspaceId}>
        <QueryProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
