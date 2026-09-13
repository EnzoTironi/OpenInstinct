"use client";

import { useState, useTransition } from "react";
import { LanguagesIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select";
import { localeNames } from "./locale";
import { changeLocale } from "./actions";
import { useI18n } from "./context";

export function LanguagePicker() {
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-2">
      <Select
        value={locale}
        disabled={pending}
        onValueChange={(value) => {
          if (!value || value === locale) return;
          setFailed(false);
          startTransition(async () => {
            try {
              await changeLocale(value);
            } catch {
              setFailed(true);
            }
          });
        }}
      >
        <SelectTrigger
          aria-label={t("Idioma")}
          className="h-11 w-full rounded-2xl px-4"
        >
          <LanguagesIcon aria-hidden="true" />
          <SelectValue>{localeNames[locale]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(localeNames).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {failed && (
        <p role="alert" className="type-caption">
          {t("Não foi possível salvar o idioma. Tente novamente.")}
        </p>
      )}
    </div>
  );
}
