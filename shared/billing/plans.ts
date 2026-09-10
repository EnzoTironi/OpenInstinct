/**
 * Hosted consumer plans (Instinct-branded). Prices are placeholders for Stripe
 * Price objects — configure real Price IDs via env; never commit secret keys.
 */

const billingPlanIds = ["free", "pro", "org"] as const;
export type BillingPlanId = (typeof billingPlanIds)[number];

/** Mirrors `Release1QuotaLimits` so UI + admission share one catalog. */
export interface PlanQuotaLimits {
  user: {
    concurrentTurns: number;
    dailyModelTokens: number;
    dailyToolCalls: number;
    dailyProactiveMessages: number;
    storageBytes: number;
    sandboxActiveSecondsPerDay: number;
  };
  installation: {
    concurrentTurns: number;
    dailyModelTokens: number;
    activeUsersPerDay: number;
  };
}

export const billingPlanCatalog = {
  free: {
    id: "free" as const,
    name: "Free",
    tagline: "Personal Companion with fair-use quotas.",
    /** Placeholder list price (USD / month). Not charged without Stripe Price. */
    placeholderPriceUsdMonthly: 0,
    features: [
      "Telegram and WhatsApp channels",
      "Personal workspace",
      "Release-1 fair-use quotas",
      "No card required",
    ],
  },
  pro: {
    id: "pro" as const,
    name: "Pro",
    tagline: "Higher personal limits for daily heavy use.",
    placeholderPriceUsdMonthly: 20,
    features: [
      "Everything in Free",
      "Higher daily model and tool budgets",
      "More storage and sandbox time",
      "Manage billing in Stripe Customer Portal",
    ],
  },
  org: {
    id: "org" as const,
    name: "Org",
    tagline: "Seat-based Companion for teams and prosumers.",
    /** Per-seat placeholder list price (USD / month). */
    placeholderPriceUsdMonthly: 30,
    features: [
      "Everything in Pro, per seat",
      "Organization workspaces and RBAC",
      "Seat quantity on the subscription",
      "Admin manages seats in Customer Portal",
    ],
  },
} as const;

/** Free matches self-host Release-1 floors; paid plans raise user ceilings. */
export const planQuotaLimits: Record<BillingPlanId, PlanQuotaLimits> = {
  free: {
    user: {
      concurrentTurns: 2,
      dailyModelTokens: 500_000,
      dailyToolCalls: 200,
      dailyProactiveMessages: 24,
      storageBytes: 100 * 1024 * 1024,
      sandboxActiveSecondsPerDay: 900,
    },
    installation: {
      concurrentTurns: 20,
      dailyModelTokens: 5_000_000,
      activeUsersPerDay: 100,
    },
  },
  pro: {
    user: {
      concurrentTurns: 4,
      dailyModelTokens: 2_500_000,
      dailyToolCalls: 1_000,
      dailyProactiveMessages: 96,
      storageBytes: 2 * 1024 * 1024 * 1024,
      sandboxActiveSecondsPerDay: 3_600,
    },
    installation: {
      concurrentTurns: 40,
      dailyModelTokens: 25_000_000,
      activeUsersPerDay: 100,
    },
  },
  org: {
    user: {
      concurrentTurns: 4,
      dailyModelTokens: 2_500_000,
      dailyToolCalls: 1_000,
      dailyProactiveMessages: 96,
      storageBytes: 2 * 1024 * 1024 * 1024,
      sandboxActiveSecondsPerDay: 3_600,
    },
    installation: {
      concurrentTurns: 80,
      dailyModelTokens: 50_000_000,
      activeUsersPerDay: 500,
    },
  },
};

/**
 * Scale org installation ceilings roughly with seat count (minimum 1).
 * User ceilings stay at the org base (each seat gets Pro-like personal caps).
 */
export function quotaLimitsForPlan(
  plan: BillingPlanId,
  seatCount = 1
): PlanQuotaLimits {
  const base = planQuotaLimits[plan];
  if (plan !== "org") return base;
  const seats = Math.max(1, Math.floor(seatCount));
  return {
    user: { ...base.user },
    installation: {
      concurrentTurns: base.installation.concurrentTurns * seats,
      dailyModelTokens: base.installation.dailyModelTokens * seats,
      activeUsersPerDay: Math.max(
        base.installation.activeUsersPerDay,
        seats * 25
      ),
    },
  };
}

export function isPaidPlan(plan: BillingPlanId): plan is "pro" | "org" {
  return plan === "pro" || plan === "org";
}
