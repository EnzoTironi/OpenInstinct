import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { companionCanonicalPath, companionPublicHost } from "../public-origin";
import { DocsPanel } from "./_components/docs-panel";

const canonical = companionCanonicalPath("/docs");

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  const title = t("Guia — primeiros passos | Zoen");
  const description = t(
    "Como começar no Zoen hospedado em {host}: vincular Telegram ou WhatsApp, chegar na home e gerenciar o plano.",
    { host: companionPublicHost }
  );
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
    },
  };
}

export default function DocsPage() {
  return <DocsPanel />;
}
