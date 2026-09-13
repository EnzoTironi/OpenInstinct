import type messages from "./messages/pt-br.json";

type MessageKey = keyof typeof messages;
export type Messages = Record<MessageKey, string>;

export function createTranslator(catalog: Messages) {
  const translations: Readonly<Record<string, string | undefined>> = catalog;
  return (key: string, values?: Readonly<Record<string, string | number>>) => {
    const template = Object.hasOwn(catalog, key)
      ? (translations[key] ?? key)
      : key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      values?.[name] === undefined ? placeholder : String(values[name])
    );
  };
}
