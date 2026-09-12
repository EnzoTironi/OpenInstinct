import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingLanding } from "../_components/marketing-landing";

describe("marketing landing", () => {
  it("uses the production host and conversion paths", () => {
    const html = renderToStaticMarkup(createElement(MarketingLanding));
    expect(html).toContain("companion.tironi.xyz");
    expect(html).toContain("https://companion.tironi.xyz");
    expect(html).not.toContain("zoen.space");
    expect(html).not.toContain("poke.com");
    expect(html).toContain("Conheça o Companion");
    expect(html).toContain("Começar grátis");
    expect(html).toContain('href="/get-started"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/docs"');
  });
});
