"use client";
import { cn } from "@web/components/class-names";
import { useLocalTime } from "./use-local-time";
import styles from "./home.module.css";

export function HomeGreeting() {
  const hour = useLocalTime()?.getHours();
  const greeting =
    hour === undefined
      ? "Um respiro no dia."
      : hour < 12
        ? "Bom dia."
        : hour < 18
          ? "Boa tarde."
          : "Boa noite.";
  return <h1 className={cn("type-signal", styles.greeting)}>{greeting}</h1>;
}
