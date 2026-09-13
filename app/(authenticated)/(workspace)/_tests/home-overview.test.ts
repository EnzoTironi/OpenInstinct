import { createElement } from "react";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import { HomeOverview } from "../../_components/home-overview";

describe("Zoen home", () => {
  it.each([
    ["pt-BR", "Automações", "Conexões", "Receitas"],
    ["en", "Automations", "Connections", "Recipes"],
    ["es", "Automatizaciones", "Conexiones", "Recetas"],
  ] as const)(
    "renders the same home links in %s",
    (locale, automations, connections, recipes) => {
      const markup = renderToStaticMarkup(createElement(HomeOverview), locale);
      for (const text of [automations, connections, recipes])
        expect(markup).toContain(text);
      expect(markup).toContain('href="/connections"');
      expect(markup).toContain('href="/recipes"');
    }
  );

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
