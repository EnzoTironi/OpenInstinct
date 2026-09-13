import { Schema } from "effect";

export const localeSchema = Schema.Literals(["pt-BR", "en", "es"]);
export type Locale = typeof localeSchema.Type;
export const localeCookie = "zoen-locale";

export const localeNames = {
  "pt-BR": "Português (Brasil)",
  en: "English",
  es: "Español",
} as const;

export function resolveLocale(
  preference?: string,
  acceptLanguage?: string | null
): Locale {
  if (Schema.is(localeSchema)(preference)) return preference;
  const languages = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q=")
      );
      return {
        tag: tag?.toLowerCase().split("-")[0],
        quality: quality ? Number(quality.trim().slice(2)) : 1,
      };
    })
    .filter(({ quality }) => quality > 0 && quality <= 1)
    .toSorted((a, b) => b.quality - a.quality);
  for (const { tag } of languages) {
    if (tag === "pt") return "pt-BR";
    if (tag === "en" || tag === "es") return tag;
  }
  return "pt-BR";
}
