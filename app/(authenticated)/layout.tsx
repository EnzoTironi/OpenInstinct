import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Schema } from "effect";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { requireRequestScope } from "@web/auth/request-scope";
import { TRPCProvider } from "@web/trpc/client";
import { PanelShell } from "./_components/panel-shell";
import { HomeOverview } from "./_components/home-overview";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Seu espaço | Zoen"),
  };
}

export default async function AuthenticatedLayout({
  children,
}: LayoutProps<"/">) {
  await requireRequestScope().catch((cause: unknown) => {
    if (Schema.is(WorkspaceAccessDenied)(cause)) notFound();
    throw cause;
  });

  return (
    <TRPCProvider>
      <PanelShell background={<HomeOverview />}>{children}</PanelShell>
    </TRPCProvider>
  );
}
