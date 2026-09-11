import { describe, expect, it } from "vitest";

import {
  billingPlanCatalog,
  planQuotaLimits,
  quotaLimitsForPlan,
} from "./plans";

describe("consumer billing plans", () => {
  it("keeps Free at Release-1 floors and requires no card", () => {
    expect(billingPlanCatalog.free.placeholderPriceUsdMonthly).toBe(0);
    expect(planQuotaLimits.free.user.dailyModelTokens).toBe(500_000);
  });

  it("raises Pro personal ceilings above Free", () => {
    expect(planQuotaLimits.pro.user.dailyModelTokens).toBeGreaterThan(
      planQuotaLimits.free.user.dailyModelTokens
    );
  });

  it("scales Org installation limits with seats", () => {
    const one = quotaLimitsForPlan("org", 1);
    const three = quotaLimitsForPlan("org", 3);
    expect(three.installation.concurrentTurns).toBe(
      one.installation.concurrentTurns * 3
    );
    expect(three.user.dailyModelTokens).toBe(one.user.dailyModelTokens);
  });
});
