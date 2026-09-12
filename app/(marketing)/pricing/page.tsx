import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAuthSession } from "@db/services/auth/session";
import { readEntitlement } from "@db/services/billing";
import type { BillingPlanId } from "@shared/billing/plans";
import { MarketingShell } from "../_components/marketing-shell";
import { companionCanonicalPath, companionPublicHost } from "../public-origin";
import { isStripeBillingConfigured } from "../../../server/billing/stripe";
import { PricingPanel } from "./_components/pricing-panel";

const title = "Preços — Free, Pro, Org | Companion";
const description = `Comece grátis, sem cartão. Pro sobe cotas pessoais. Org vende assentos. Hospedado em ${companionPublicHost}.`;
const canonical = companionCanonicalPath("/pricing");

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

export default async function PricingPage() {
  const session = await getAuthSession(await headers());
  let currentPlan: BillingPlanId = "free";
  if (session?.user) {
    const entitlement = await readEntitlement("user", session.user.id);
    currentPlan = entitlement.plan;
  }
  return (
    <MarketingShell active="pricing">
      <PricingPanel
        currentPlan={currentPlan}
        signedIn={Boolean(session?.user)}
        stripeConfigured={isStripeBillingConfigured()}
      />
    </MarketingShell>
  );
}
