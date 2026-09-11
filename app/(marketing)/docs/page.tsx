import type { Metadata } from "next";

import { DocsPanel } from "./_components/docs-panel";

export const metadata: Metadata = {
  title: "Docs — consumer first-run | Companion",
  description:
    "How to get started with hosted Companion: bind Telegram or WhatsApp, land on home, and manage your plan.",
};

export default function DocsPage() {
  return <DocsPanel />;
}
