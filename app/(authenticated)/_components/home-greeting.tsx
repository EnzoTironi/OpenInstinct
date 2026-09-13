"use client";
import { cn } from "@web/components/class-names";
import { getLocalDay } from "./local-day";
import { useLocalTime } from "./use-local-time";
import styles from "./home.module.css";

export function HomeGreeting() {
  const { greeting } = getLocalDay(useLocalTime());
  return <h1 className={cn("type-signal", styles.greeting)}>{greeting}</h1>;
}
