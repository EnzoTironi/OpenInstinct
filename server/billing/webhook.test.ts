import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { handleStripeWebhook, BillingWebhookError } from "./webhook";

describe("Stripe billing webhook", () => {
  it("rejects when Stripe is not configured", async () => {
    const request = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: "{}",
    });
    const error = await Effect.runPromise(
      handleStripeWebhook(request).pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(BillingWebhookError);
    expect(error.reason).toBe("stripe_not_configured");
  });
});
