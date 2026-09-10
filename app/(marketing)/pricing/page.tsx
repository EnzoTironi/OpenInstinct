import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAuthSession } from "@db/services/auth/session";
import { readEntitlement } from "@db/services/billing";
import type { BillingPlanId } from "@shared/billing/plans";
import { MarketingShell } from "../_components/marketing-shell";
import { isStripeBillingConfigured } from "../../../server/billing/stripe";
import { PricingPanel } from "./_components/pricing-panel";

export const metadata: Metadata = {
  title: "Pricing — Free, Pro, Org | Companion",
  description:
    "Start free with no card. Pro raises personal quotas. Org sells seats for teams. Companion by Instinct.",
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
