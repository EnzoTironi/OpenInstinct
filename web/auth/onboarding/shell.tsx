"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@web/components/ui/logo";
import { Sky } from "@web/components/sky/sky";
import { getLocalDay } from "@web/components/sky/local-day";
import { useLocalTime } from "@web/components/sky/use-local-time";
import { LanguagePicker } from "@web/i18n/language-picker";
import { useI18n } from "@web/i18n/context";
import styles from "./onboarding.module.css";

export function OnboardingShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  const { sky } = getLocalDay(useLocalTime());
  return (
    <div className={styles.shell}>
      <Sky phase={sky} />
      <header className={styles.header}>
        <Link
          href="/welcome"
          className={styles.brand}
          aria-label={t("Zoen — início")}
        >
          <Logo /> <span>Zoen</span>
        </Link>
        <div className={styles.language}>
          <LanguagePicker compact />
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        {t("Menos na cabeça. Mais na vida.")}
      </footer>
    </div>
  );
}
