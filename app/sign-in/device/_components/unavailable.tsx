"use client";

import { useI18n } from "@web/i18n/context";
import Link from "next/link";
import { OnboardingShell } from "@web/auth/onboarding/shell";
import { cn } from "@web/components/class-names";
import styles from "@web/auth/onboarding/onboarding.module.css";
import { Button } from "@web/components/ui/button";

export function DeviceSignInUnavailable() {
  const { t } = useI18n();
  return (
    <OnboardingShell>
      <section className={cn(styles.card, styles.deviceCard, "space-y-6")}>
        <div className="space-y-2">
          <h1 className="type-page-title">
            {t("This sign-in link is not valid")}
          </h1>
          <p className="type-supporting-body text-muted-foreground">
            {t(
              "Peça um novo link neste navegador e confirme no seu mensageiro."
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button nativeButton={false} render={<Link href="/sign-in" />}>
            {t("Sign in")}
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/get-started" />}
            variant="outline"
          >
            {t("Get started")}
          </Button>
        </div>
      </section>
    </OnboardingShell>
  );
}
