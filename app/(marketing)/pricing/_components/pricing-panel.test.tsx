import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingPanel } from "./pricing-panel";

describe("pricing Free CTA", () => {
  it("labels signed-out Free as Começar grátis, not Plano atual", () => {
    const html = renderToStaticMarkup(
      createElement(PricingPanel, {
        signedIn: false,
        currentPlan: "free",
        stripeConfigured: false,
      })
    );
    expect(html).toContain("Começar grátis");
    expect(html).toContain('href="/get-started"');
    expect(html).not.toContain("Plano atual");
  });

  it("labels signed-in Free as Plano atual", () => {
    const html = renderToStaticMarkup(
      createElement(PricingPanel, {
        signedIn: true,
        currentPlan: "free",
        stripeConfigured: false,
      })
    );
    expect(html).toContain("Plano atual");
    expect(html).toContain('href="/account"');
  });
});
