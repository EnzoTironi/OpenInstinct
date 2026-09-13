import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeOverview } from "../../_components/home-overview";

describe("Zoen home", () => {
  it("links the five primary actions to real panel routes in the same tab", () => {
    const html = renderToStaticMarkup(createElement(HomeOverview));
    for (const href of [
      "/chat",
      "/reminders",
      "/connections",
      "/recipes",
      "/mail",
    ])
      expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('disabled=""');
  });
  it("keeps messenger settings in Connections and history in chat", () => {
    const html = renderToStaticMarkup(createElement(HomeOverview));
    expect(html).not.toContain('href="/account"');
    expect(html).not.toContain('href="/chat/history"');
    expect(html).not.toContain("Conectar um mensageiro");
  });
});
