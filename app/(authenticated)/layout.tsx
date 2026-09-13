import type { Metadata } from "next";
import { requireRequestScope } from "@web/auth/request-scope";
import { TRPCProvider } from "@web/trpc/client";
import { PanelShell } from "./_components/panel-shell";
import { HomeOverview } from "./_components/home-overview";

export const metadata: Metadata = {
  title: "Seu espaço | Zoen",
};

export default async function AuthenticatedLayout({
  children,
}: LayoutProps<"/">) {
  await requireRequestScope();

  return (
    <TRPCProvider>
      <PanelShell background={<HomeOverview />}>{children}</PanelShell>
    </TRPCProvider>
  );
}
