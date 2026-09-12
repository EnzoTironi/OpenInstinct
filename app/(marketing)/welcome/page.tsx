import type { Metadata } from "next";
import { companionCanonicalPath, companionPublicHost } from "../public-origin";
import { MarketingLanding } from "./_components/marketing-landing";

const title = "Companion — seu assistente no trabalho | Instinct";
const description = `Companion by Instinct no Telegram e no WhatsApp. Comece grátis em ${companionPublicHost} — sem cartão.`;
const canonical = companionCanonicalPath("/welcome");

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

export default function WelcomePage() {
  return <MarketingLanding />;
}
