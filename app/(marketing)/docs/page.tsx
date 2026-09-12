import type { Metadata } from "next";
import { companionCanonicalPath, companionPublicHost } from "../public-origin";
import { DocsPanel } from "./_components/docs-panel";

const title = "Guia — primeiros passos | Companion";
const description = `Como começar no Companion hospedado em ${companionPublicHost}: vincular Telegram ou WhatsApp, chegar na home e gerenciar o plano.`;
const canonical = companionCanonicalPath("/docs");

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    title,
    description,
    url: canonical,
  },
};

export default function DocsPage() {
  return <DocsPanel />;
}
