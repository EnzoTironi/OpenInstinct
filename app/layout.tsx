import { QueryProvider } from "@app/_providers/query-provider";
import { getAuthSession } from "@db/services/auth/session";
import { applicationOrigin } from "@shared/environment/origin";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { TooltipProvider } from "@web/components/ui/tooltip";
import type { Metadata } from "next";
import { headers } from "next/headers";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(applicationOrigin()),
  title: "OpenInstinct",
  description:
    "A self-hosted personal agent with private credentials and Kernel-powered browser execution.",
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
