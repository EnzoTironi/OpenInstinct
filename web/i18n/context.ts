"use client";

import { createContext, useContext } from "react";
import type { Locale } from "./locale";
import type { createTranslator } from "./translate";

export const I18nContext = createContext<{
  locale: Locale;
  t: ReturnType<typeof createTranslator>;
} | null>(null);

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n requires I18nProvider");
  return context;
}
