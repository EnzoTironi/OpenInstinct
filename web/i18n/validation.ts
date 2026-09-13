import { z } from "zod";
import type { Locale } from "./locale";

const validationLocales = {
  "pt-BR": z.locales.ptBR(),
  en: z.locales.en(),
  es: z.locales.es(),
};

export function validationOptions(locale: Locale) {
  return { error: validationLocales[locale].localeError };
}
