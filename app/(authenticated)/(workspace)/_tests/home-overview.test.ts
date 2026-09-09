import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeOverview } from "../_components/home-overview";

describe("Companion home", () => {
  it("renders real destinations with conversation first and browser tools secondary", () => {
    const html = renderToStaticMarkup(createElement(HomeOverview));
    expect(html).toContain('href="/chat"');
    expect(html).toContain("Start a conversation");
    expect(html).toContain('href="/personal-info"');
    expect(html).toContain('href="/chat/history"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain("Browser activity");
    expect(html).toContain('href="/vault"');
    expect(html.indexOf("Start a conversation")).toBeLessThan(
      html.indexOf("Browser tools")
    );
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("iMessage");
  });
});
