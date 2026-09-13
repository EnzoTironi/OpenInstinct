import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { companionCanonicalPath, companionPublicHost } from "../public-origin";
import { MarketingLanding } from "./_components/marketing-landing";

const canonical = companionCanonicalPath("/welcome");

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  const title = t("Zoen — sua vida tem companhia");
  const description = t(
    "Um Zoen que lembra, organiza, resolve e coordena com suas pessoas de confiança. Converse no WhatsApp, Telegram ou em {host}.",
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

export default function WelcomePage() {
  return <MarketingLanding />;
}
