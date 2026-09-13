import { cache } from "react";
import { cookies, headers } from "next/headers";
import { localeCookie, resolveLocale } from "./locale";
import { createTranslator, type Messages } from "./translate";
import ptBR from "./messages/pt-br.json";
import en from "./messages/en.json";
import es from "./messages/es.json";

const catalogs = { "pt-BR": ptBR, en, es } satisfies Record<string, Messages>;

export const getI18n = cache(async () => {
  const preference = (await cookies()).get(localeCookie)?.value;
  const locale = resolveLocale(
    preference,
    (await headers()).get("accept-language")
  );
  const messages = catalogs[locale];
  return { locale, messages, t: createTranslator(messages) };
});
