import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocsPanel } from "../_components/docs-panel";

describe("docs panel", () => {
  it("describes the hosted first-run on companion.tironi.xyz", () => {
    const html = renderToStaticMarkup(createElement(DocsPanel));
    expect(html).toContain("companion.tironi.xyz");
    expect(html).toContain("https://companion.tironi.xyz");
    expect(html).not.toContain("zoen.space");
    expect(html).not.toContain("poke.com");
    expect(html).toContain("Primeiros passos");
    expect(html).toContain('href="/get-started"');
    expect(html).toContain('href="/welcome"');
  });
});
