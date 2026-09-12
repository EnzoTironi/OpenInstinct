import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingPanel } from "./pricing-panel";

describe("pricing Free CTA", () => {
  it("labels signed-out Free as Start free, not Current plan", () => {
    const html = renderToStaticMarkup(
      createElement(PricingPanel, {
        signedIn: false,
        currentPlan: "free",
        stripeConfigured: false,
      })
    );
    expect(html).toContain("Start free");
    expect(html).toContain('href="/get-started"');
    expect(html).not.toContain("Current plan");
  });

  it("labels signed-in Free as Current plan", () => {
    const html = renderToStaticMarkup(
      createElement(PricingPanel, {
        signedIn: true,
        currentPlan: "free",
        stripeConfigured: false,
      })
    );
    expect(html).toContain("Current plan");
    expect(html).toContain('href="/account"');
  });
});
