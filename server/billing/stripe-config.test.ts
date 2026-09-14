import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requiredEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret-0123456789abcdefghijklmnop",
  BETTER_AUTH_URL: "https://example.com",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("Stripe billing configuration gates", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [name, value] of Object.entries(requiredEnvironment)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_PRICE_PRO", "");
    vi.stubEnv("STRIPE_PRICE_ORG_SEAT", "");
    vi.stubEnv("ZOEN_BILLING_MODE", "free-beta");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports billing disabled when STRIPE_* are unset", async () => {
    const {
      isStripeBillingConfigured,
      isStripeCheckoutConfigured,
      isStripePortalConfigured,
    } = await import("./stripe");
    expect(isStripeBillingConfigured()).toBe(false);
    expect(isStripeCheckoutConfigured("pro")).toBe(false);
    expect(isStripeCheckoutConfigured("org")).toBe(false);
    expect(isStripePortalConfigured()).toBe(false);
  });

  it("enables Pro Checkout when secret and Pro price are set", async () => {
    vi.stubEnv("ZOEN_BILLING_MODE", "paid");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_synthetic");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_synthetic");
    const {
      isStripeBillingConfigured,
      isStripeCheckoutConfigured,
      isStripePortalConfigured,
    } = await import("./stripe");
    expect(isStripeBillingConfigured()).toBe(true);
    expect(isStripeCheckoutConfigured("pro")).toBe(true);
    expect(isStripeCheckoutConfigured("org")).toBe(false);
    expect(isStripePortalConfigured()).toBe(true);
  });

  it("locks every paid entrypoint during the beta even when credentials exist", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_synthetic");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_synthetic");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_synthetic");
    vi.stubEnv("STRIPE_PRICE_ORG_SEAT", "price_org_synthetic");
    const billing = await import("./stripe");
    expect(billing.isStripeBillingConfigured()).toBe(false);
    expect(billing.isStripePortalConfigured()).toBe(false);
    expect(billing.requireStripe).toThrow(billing.StripeNotConfiguredError);
    expect(billing.stripeWebhookSecret).toThrow(
      billing.StripeNotConfiguredError
    );
    expect(() => billing.stripePriceIdForPlan("pro")).toThrow(
      billing.StripeNotConfiguredError
    );
    expect(() => billing.stripePriceIdForPlan("org")).toThrow(
      billing.StripeNotConfiguredError
    );
  });
});
