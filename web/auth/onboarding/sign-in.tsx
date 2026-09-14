"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@web/i18n/context";
import { GoogleSignInButton } from "@web/auth/google-button";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { OnboardingFrame } from "./frame";
import styles from "./onboarding.module.css";

export function OnboardingSignIn({
  googleAvailable,
  callbackUrl,
  children,
}: {
  readonly googleAvailable: boolean;
  readonly callbackUrl: string;
  readonly children?: ReactNode;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  return (
    <OnboardingFrame step={step} onStep={setStep}>
      {children}
      {googleAvailable ? (
        <>
          <GoogleSignInButton callbackUrl={callbackUrl} />
          <details className={styles.alternative}>
            <summary>{t("Já tenho um mensageiro conectado")}</summary>
            <div className={styles.alternativeBody}>
              <ChannelAuthForm purpose="login" callbackUrl={callbackUrl} />
            </div>
          </details>
        </>
      ) : (
        <ChannelAuthForm purpose="login" callbackUrl={callbackUrl} />
      )}
    </OnboardingFrame>
  );
}
