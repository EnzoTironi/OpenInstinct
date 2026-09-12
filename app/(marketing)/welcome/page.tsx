import type { Metadata } from "next";
import { companionCanonicalPath, companionPublicHost } from "../public-origin";
import { MarketingLanding } from "./_components/marketing-landing";

const title = "Zoen — sua vida tem companhia";
const description = `Um Zoen que lembra, organiza, resolve e coordena com suas pessoas de confiança. Converse no WhatsApp, Telegram ou em ${companionPublicHost}.`;
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
