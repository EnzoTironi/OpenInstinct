import type { Metadata } from "next";

import { MarketingLanding } from "./_components/marketing-landing";

export const metadata: Metadata = {
  title: "Companion — your assistant in chat | Instinct",
  description:
    "Companion by Instinct works in Telegram and WhatsApp for people, prosumers, and orgs. Start free — no card required.",
};

export default function WelcomePage() {
  return <MarketingLanding />;
}
