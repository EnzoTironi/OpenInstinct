import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveLocale } from "./locale";
import { createTranslator } from "./translate";
import { validationOptions } from "./validation";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { useI18n } from "./context";
import ptBR from "./messages/pt-br.json";
import en from "./messages/en.json";
import es from "./messages/es.json";

describe("locale selection", () => {
  it("keeps the saved preference ahead of the browser language", () => {
    expect(resolveLocale("es", "pt-BR,en;q=0.8")).toBe("es");
    expect(resolveLocale("en", "es")).toBe("en");
  });
  it("negotiates supported languages by quality and ignores excluded languages", () => {
    expect(resolveLocale(undefined, "fr,es-MX;q=0.9,en-US;q=0.8")).toBe("es");
    expect(resolveLocale(undefined, "en;q=0,pt-PT;q=0.5")).toBe("pt-BR");
    expect(resolveLocale("invalid", "es;q=0.3,en;q=0.9")).toBe("en");
    expect(resolveLocale(undefined, "fr;q=bogus")).toBe("pt-BR");
  });
});

describe("translated UI", () => {
  it("has the same messages and interpolation values in every catalog", () => {
    for (const catalog of [en, es]) {
      expect(Object.keys(catalog).toSorted()).toEqual(
        Object.keys(ptBR).toSorted()
      );
      for (const [key, value] of Object.entries(ptBR)) {
        const translated = Object.entries(catalog).find(
          ([candidate]) => candidate === key
        )?.[1];
        expect(translated).toBeTruthy();
        expect(translated?.match(/\{\w+\}/g)?.toSorted()).toEqual(
          value.match(/\{\w+\}/g)?.toSorted()
        );
      }
    }
  });
  it("interpolates user values without translating or interpreting their contents", () => {
    expect(renderToStaticMarkup(<Message />, "en")).toBe(
      "<p>Open &lt;script&gt;$&amp;{name}&lt;/script&gt;</p>"
    );
    expect(createTranslator(es)("Telegram")).toBe("Telegram");
  });
  it("localizes validation per parse without changing another request's language", () => {
    const schema = z.string().min(3);
    const english = schema.safeParse("", validationOptions("en"));
    const spanish = schema.safeParse("", validationOptions("es"));
    const portuguese = schema.safeParse("", validationOptions("pt-BR"));
    expect(english.error?.issues[0]?.message).toContain("Too small");
    expect(spanish.error?.issues[0]?.message).not.toEqual(
      english.error?.issues[0]?.message
    );
    expect(portuguese.error?.issues[0]?.message).not.toEqual(
      spanish.error?.issues[0]?.message
    );
    expect(schema.safeParse("", validationOptions("en")).error?.issues).toEqual(
      english.error?.issues
    );
  });
});

function Message() {
  const { t } = useI18n();
  return <p>{t("Abrir {name}", { name: "<script>$&{name}</script>" })}</p>;
}
