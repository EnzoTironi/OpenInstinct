"use client";
import { useI18n } from "@web/i18n/context";
import { cn } from "@web/components/class-names";
import { getLocalDay } from "@web/components/sky/local-day";
import { useLocalTime } from "@web/components/sky/use-local-time";
import styles from "./home.module.css";

export function HomeGreeting() {
  const { t } = useI18n();
  const { greeting } = getLocalDay(useLocalTime());
  return <h1 className={cn("type-signal", styles.greeting)}>{t(greeting)}</h1>;
}
