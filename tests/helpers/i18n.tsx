import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { I18nProvider } from "@web/i18n/provider";
import type { Locale } from "@web/i18n/locale";
import ptBR from "@web/i18n/messages/pt-br.json";
import en from "@web/i18n/messages/en.json";
import es from "@web/i18n/messages/es.json";

const catalogs = { "pt-BR": ptBR, en, es };

export function renderToStaticMarkup(
  node: ReactNode,
  locale: Locale = "pt-BR"
) {
  return renderMarkup(
    <I18nProvider locale={locale} messages={catalogs[locale]}>
      {node}
    </I18nProvider>
  );
}

export function renderToEnglishMarkup(node: ReactNode) {
  return renderToStaticMarkup(node, "en");
}
