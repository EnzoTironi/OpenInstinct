import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingPanel } from "../_components/pricing-panel";

describe("pricing panel", () => {
  it("keeps checkout honesty and the production host for signed-out visitors", () => {
    const html = renderToStaticMarkup(
      createElement(PricingPanel, {
        currentPlan: "free",
        signedIn: false,
        stripeConfigured: false,
      })
    );
    expect(html).toContain("companion.tironi.xyz");
    expect(html).toContain("https://companion.tironi.xyz");
    expect(html).not.toContain("zoen.space");
    expect(html).not.toContain("poke.com");
    expect(html).toContain("Comece grátis");
    expect(html).toContain("Checkout indisponível");
    expect(html).toContain("Começar grátis");
    expect(html).toContain('href="/get-started"');
    expect(html).not.toContain("Plano atual");
  });
});
