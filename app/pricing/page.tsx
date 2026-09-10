import { headers } from "next/headers";
import { getAuthSession } from "@db/services/auth/session";
import { readEntitlement } from "@db/services/billing";
import type { BillingPlanId } from "@shared/billing/plans";
import { PricingPanel } from "./_components/pricing-panel";

export default async function PricingPage() {
  const session = await getAuthSession(await headers());
  let currentPlan: BillingPlanId = "free";
  if (session?.user) {
    const entitlement = await readEntitlement("user", session.user.id);
    currentPlan = entitlement.plan;
  }
  return (
    <main className="min-h-svh bg-background text-foreground">
      <PricingPanel
        currentPlan={currentPlan}
        signedIn={Boolean(session?.user)}
      />
    </main>
  );
}
